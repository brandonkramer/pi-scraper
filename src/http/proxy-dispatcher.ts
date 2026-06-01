import tls from "node:tls";

/** @file Proxy dispatcher factory — routes HTTP/HTTPS/SOCKS5/SOCKS4 to the right undici agent. */
import { SocksClient } from "socks";
import { Pool, ProxyAgent, Socks5ProxyAgent, type Dispatcher } from "undici";

import { HttpClientError } from "./errors.ts";

const SUPPORTED_SCHEMES = new Set(["http:", "https:", "socks5:", "socks:", "socks4:"]);
const REJECTED_SCHEMES = new Set(["socks5h:", "socks4a:"]);

export function isSupportedProxyScheme(proxyUrl: string): boolean {
	try {
		const url = new URL(proxyUrl);
		return SUPPORTED_SCHEMES.has(url.protocol);
	} catch {
		return false;
	}
}

export function createProxyDispatcher(proxyUrl: string): Dispatcher {
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

	if (REJECTED_SCHEMES.has(url.protocol)) {
		throw new HttpClientError({
			code: "UNSUPPORTED_PROXY_SCHEME",
			phase: "proxy",
			message: `Unsupported proxy scheme: ${url.protocol}`,
			retryable: false,
		});
	}

	if (url.protocol === "http:" || url.protocol === "https:") {
		return new ProxyAgent(proxyUrl);
	}

	if (url.protocol === "socks5:" || url.protocol === "socks:") {
		return new Socks5ProxyAgent(proxyUrl);
	}

	if (url.protocol === "socks4:") {
		return new Socks4ProxyAgent(proxyUrl) as unknown as Dispatcher;
	}

	throw new HttpClientError({
		code: "UNSUPPORTED_PROXY_SCHEME",
		phase: "proxy",
		message: `Unsupported proxy scheme: ${url.protocol}`,
		retryable: false,
	});
}

/** Minimal SOCKS4 undici Dispatcher backed by the `socks` package. */
class Socks4ProxyAgent {
	private pools = new Map<string, Pool>();
	private proxyUrl: URL;

	constructor(proxyUrl: string) {
		this.proxyUrl = new URL(proxyUrl);
	}

	dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
		const origin = String(opts.origin);
		let pool = this.pools.get(origin);
		if (!pool || pool.destroyed || pool.closed) {
			pool = new Pool(origin, {
				connect: (connectOpts, callback) => {
					const targetUrl = new URL(origin);
					const targetHost = targetUrl.hostname;
					const targetPort =
						parseInt(targetUrl.port, 10) || (targetUrl.protocol === "https:" ? 443 : 80);

					void SocksClient.createConnection(
						{
							command: "connect",
							proxy: {
								host: this.proxyUrl.hostname,
								port: parseInt(this.proxyUrl.port, 10),
								type: 4,
								userId: this.proxyUrl.username
									? decodeURIComponent(this.proxyUrl.username)
									: undefined,
							},
							destination: { host: targetHost, port: targetPort },
						},
						(error, result) => {
							if (error || !result) {
								callback(error ?? new Error("SOCKS4 connection failed"), null);
								return;
							}
							const { socket } = result;
							if (targetUrl.protocol === "https:") {
								const tlsOptions = (connectOpts as unknown as { tls?: Record<string, unknown> })
									.tls;
								const tlsSocket = tls.connect({
									socket,
									servername: targetHost,
									...tlsOptions,
								});
								tlsSocket.once("secureConnect", () => callback(null, tlsSocket));
								tlsSocket.once("error", (err) => callback(err, null));
							} else {
								callback(null, socket);
							}
						},
					);
				},
			});
			this.pools.set(origin, pool);
		}
		return pool.dispatch(opts, handler);
	}

	async close(): Promise<void> {
		for (const pool of this.pools.values()) {
			await pool.close();
		}
	}

	async destroy(err?: Error | null): Promise<void> {
		for (const pool of this.pools.values()) {
			await pool.destroy(err ?? null);
		}
	}
}
