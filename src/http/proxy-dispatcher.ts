import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type Socket } from "node:net";
import tls from "node:tls";

/** @file Proxy dispatcher factory — routes HTTP/HTTPS/SOCKS5/SOCKS4 to the right undici agent. */
import { SocksClient } from "socks";
import { Dispatcher, Pool, ProxyAgent } from "undici";

import { HttpClientError } from "./errors.ts";
import { assertPublicAddresses, type UrlSafetyOptions } from "./url-safety.ts";

const HTTP_PROXY_SCHEMES = new Set(["http:", "https:"]);
const SOCKS_PROXY_SCHEMES = new Set(["socks5:", "socks:", "socks4:"]);
const SUPPORTED_SCHEMES = new Set([...HTTP_PROXY_SCHEMES, ...SOCKS_PROXY_SCHEMES]);
const REJECTED_SCHEMES = new Set(["socks5h:", "socks4a:"]);

export interface ProxyDispatcherOptions extends Pick<UrlSafetyOptions, "allowPrivateNetwork"> {
	lookupTargetAddresses?: (hostname: string) => Promise<readonly LookupAddress[]>;
}

type PoolConnectCallback = (...args: [null, Socket | tls.TLSSocket] | [Error, null]) => void;

export function isSupportedProxyScheme(proxyUrl: string): boolean {
	try {
		return SUPPORTED_SCHEMES.has(new URL(proxyUrl).protocol);
	} catch {
		return false;
	}
}

export function validateProxyUrl(proxyUrl: string): URL {
	let url: URL;
	try {
		url = new URL(proxyUrl);
	} catch {
		throw new HttpClientError({
			code: "INVALID_PROXY_URL",
			phase: "proxy",
			message: `Could not parse proxy URL: ${proxyUrl}`,
			retryable: false,
		});
	}

	if (!url.hostname) {
		throw new HttpClientError({
			code: "INVALID_PROXY_URL",
			phase: "proxy",
			message: `Proxy URL must include a hostname: ${proxyUrl}`,
			retryable: false,
		});
	}

	if (REJECTED_SCHEMES.has(url.protocol) || !SUPPORTED_SCHEMES.has(url.protocol)) {
		throw new HttpClientError({
			code: "UNSUPPORTED_PROXY_SCHEME",
			phase: "proxy",
			message: `Unsupported proxy scheme: ${url.protocol}`,
			retryable: false,
		});
	}

	return url;
}

export function isSocksProxyUrl(proxyUrl: URL): boolean {
	return SOCKS_PROXY_SCHEMES.has(proxyUrl.protocol);
}

export function createProxyDispatcher(
	proxyUrl: string,
	options: ProxyDispatcherOptions = {},
): Dispatcher {
	const url = validateProxyUrl(proxyUrl);

	if (HTTP_PROXY_SCHEMES.has(url.protocol)) {
		return new ProxyAgent(proxyUrl);
	}

	return new LocalDnsSocksProxyAgent(url, url.protocol === "socks4:" ? 4 : 5, options);
}

/** SOCKS dispatcher that resolves destination hostnames locally before proxy CONNECT. */
class LocalDnsSocksProxyAgent extends Dispatcher {
	private readonly pools = new Map<string, Pool>();
	private readonly proxyPort: number;
	private readonly proxyHost: string;

	constructor(
		private readonly proxyUrl: URL,
		private readonly socksVersion: 4 | 5,
		private readonly options: ProxyDispatcherOptions,
	) {
		super();
		this.proxyHost = stripIpv6Brackets(proxyUrl.hostname);
		this.proxyPort = proxyPort(proxyUrl);
	}

	dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
		const origin = String(opts.origin);
		let pool = this.pools.get(origin);
		if (!pool || pool.destroyed || pool.closed) {
			pool = new Pool(origin, {
				connect: (_connectOpts, callback) => {
					this.connectThroughSocksForPool(origin, callback);
				},
			});
			this.pools.set(origin, pool);
		}
		return pool.dispatch(opts, handler);
	}

	close(): Promise<void>;
	close(callback: () => void): void;
	close(callback?: () => void): Promise<void> | void {
		const promise = this.closePools();
		if (callback) {
			notifyWhenSettled(promise, callback);
			return;
		}
		return promise;
	}

	destroy(): Promise<void>;
	destroy(err: Error | null): Promise<void>;
	destroy(callback: () => void): void;
	destroy(err: Error | null, callback: () => void): void;
	destroy(
		errOrCallback?: Error | null | (() => void),
		callback?: () => void,
	): Promise<void> | void {
		const err = typeof errOrCallback === "function" ? null : (errOrCallback ?? null);
		const done = typeof errOrCallback === "function" ? errOrCallback : callback;
		const promise = this.destroyPools(err);
		if (done) {
			notifyWhenSettled(promise, done);
			return;
		}
		return promise;
	}

	private connectThroughSocksForPool(origin: string, callback: PoolConnectCallback): void {
		void this.connectThroughSocksForPoolAsync(origin, callback);
	}

	private async connectThroughSocksForPoolAsync(
		origin: string,
		callback: PoolConnectCallback,
	): Promise<void> {
		let socket: Socket | tls.TLSSocket;
		try {
			socket = await this.connectThroughSocks(origin);
		} catch (error) {
			callback(errorFromUnknown(error), null);
			return;
		}
		callback(null, socket);
	}

	private async connectThroughSocks(origin: string): Promise<Socket | tls.TLSSocket> {
		const targetUrl = new URL(origin);
		const targetHost = stripIpv6Brackets(targetUrl.hostname);
		const targetPort = originPort(targetUrl);
		const destinationHost = await this.resolveDestinationHost(targetHost, targetUrl.toString());
		const result = await SocksClient.createConnection({
			command: "connect",
			proxy: {
				host: this.proxyHost,
				port: this.proxyPort,
				type: this.socksVersion,
				userId: decodeUrlComponent(this.proxyUrl.username),
				password: decodeUrlComponent(this.proxyUrl.password),
			},
			destination: { host: destinationHost, port: targetPort },
		});

		if (targetUrl.protocol !== "https:") {
			return result.socket;
		}

		return await connectTls(result.socket, targetHost);
	}

	private async resolveDestinationHost(hostname: string, url: string): Promise<string> {
		const family = isIP(hostname);
		if (family !== 0) {
			this.assertDestinationAllowed([hostname], url);
			return this.socksDestinationAddress(hostname, family, url);
		}

		const lookup = this.options.lookupTargetAddresses ?? lookupTargetAddresses;
		const records = await lookup(hostname);
		if (records.length === 0) {
			throw new Error(`No DNS addresses returned for ${hostname}`);
		}
		this.assertDestinationAllowed(
			records.map((record) => record.address),
			url,
		);
		const record =
			this.socksVersion === 4 ? records.find((entry) => entry.family === 4) : records[0];
		if (!record) {
			throw unsupportedProxyTarget(
				`SOCKS4 proxy requires a local IPv4 DNS result for ${hostname}`,
				url,
			);
		}
		return this.socksDestinationAddress(record.address, record.family, url);
	}

	private socksDestinationAddress(address: string, family: number, url: string): string {
		if (this.socksVersion === 4 && family !== 4) {
			throw unsupportedProxyTarget("SOCKS4 proxy only supports IPv4 destinations", url);
		}
		return address;
	}

	private assertDestinationAllowed(addresses: readonly string[], url: string): void {
		if (this.options.allowPrivateNetwork === true) {
			return;
		}
		assertPublicAddresses(addresses, url);
	}

	private async closePools(): Promise<void> {
		for (const pool of this.pools.values()) {
			await pool.close();
		}
	}

	private async destroyPools(err: Error | null): Promise<void> {
		for (const pool of this.pools.values()) {
			await pool.destroy(err);
		}
	}
}

async function lookupTargetAddresses(hostname: string): Promise<LookupAddress[]> {
	return await dnsLookup(hostname, { all: true, verbatim: true });
}

function originPort(url: URL): number {
	if (url.port) {
		return Number.parseInt(url.port, 10);
	}
	return url.protocol === "https:" ? 443 : 80;
}

function proxyPort(url: URL): number {
	if (url.port) {
		return Number.parseInt(url.port, 10);
	}
	if (url.protocol === "http:") {
		return 80;
	}
	if (url.protocol === "https:") {
		return 443;
	}
	return 1080;
}

function stripIpv6Brackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function decodeUrlComponent(value: string): string | undefined {
	return value ? decodeURIComponent(value) : undefined;
}

function connectTls(socket: Socket, servername: string): Promise<tls.TLSSocket> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const tlsSocket = tls.connect({ socket, servername });
		const settle = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			callback();
		};
		tlsSocket.once("secureConnect", () => settle(() => resolve(tlsSocket)));
		tlsSocket.once("error", (error) => settle(() => reject(error)));
	});
}

function unsupportedProxyTarget(message: string, url: string): HttpClientError {
	return new HttpClientError({
		code: "UNSUPPORTED_PROXY_TARGET",
		phase: "proxy",
		message,
		retryable: false,
		url,
	});
}

function notifyWhenSettled(promise: Promise<void>, callback: () => void): void {
	void (async () => {
		try {
			await promise;
		} catch {
			// Dispatcher callback APIs do not expose close/destroy errors.
		}
		callback();
	})();
}

function errorFromUnknown(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
