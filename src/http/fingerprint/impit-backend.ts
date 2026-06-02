/** @file Impit backend for mode: "fingerprint". */

import { isIP } from "node:net";

import { Impit, type Browser } from "impit";

import { HttpClientError } from "../errors.ts";
import { isSocksProxyUrl, validateProxyUrl } from "../proxy-dispatcher.ts";
import {
	UnsupportedFingerprintOptionError,
	type FingerprintBackendFactory,
	type FingerprintBackendKey,
	type FingerprintBackendRequestOptions,
	type FingerprintBackendResponse,
	type FingerprintRequestBackend,
} from "./types.ts";

const BROWSER_PROFILE_MAP: Record<string, Browser | undefined> = {
	chrome: "chrome142",
	chrome100: "chrome100",
	chrome101: "chrome101",
	chrome104: "chrome104",
	chrome107: "chrome107",
	chrome110: "chrome110",
	chrome116: "chrome116",
	chrome124: "chrome124",
	chrome125: "chrome125",
	chrome131: "chrome131",
	chrome136: "chrome136",
	chrome142: "chrome142",
	firefox: "firefox144",
	firefox128: "firefox128",
	firefox133: "firefox133",
	firefox135: "firefox135",
	firefox144: "firefox144",
};

/**
 * Impit-based fingerprint backend factory.
 *
 * @remarks
 *   Configured per-hop with `followRedirects: false` so pi-scraper owns the redirect chain and SSRF
 *   revalidation. No cookie jar — session cookies flow through request headers managed by
 *   `src/http/session.ts`.
 */
export type ImpitConstructor = new (options?: {
	browser?: Browser;
	followRedirects?: boolean;
	maxRedirects?: number;
	proxyUrl?: string;
}) => {
	fetch: (
		resource: string | URL | Request,
		init?: {
			method?: string;
			headers?: Record<string, string>;
			redirect?: string;
			signal?: AbortSignal;
		},
	) => Promise<{
		status: number;
		statusText: string;
		headers: Headers;
		body: ReadableStream<Uint8Array>;
		url: string;
	}>;
};

/**
 * Impit-based fingerprint backend factory.
 *
 * @remarks
 *   Configured per-hop with `followRedirects: false` so pi-scraper owns the redirect chain and SSRF
 *   revalidation. No cookie jar — session cookies flow through request headers managed by
 *   `src/http/session.ts`. An optional `createImpit` parameter allows dependency injection for
 *   tests.
 */
export async function makeImpitBackend(
	key: FingerprintBackendKey,
	createImpit?: ImpitConstructor,
): Promise<FingerprintRequestBackend> {
	const browserName = resolveBrowserProfile(key.browserProfile);
	const proxyUrl = validateImpitProxy(key.proxy, key.host);
	const ImpitCtor = (createImpit ?? Impit) as ImpitConstructor;
	const impit = new ImpitCtor({
		browser: browserName,
		followRedirects: false,
		maxRedirects: 0,
		proxyUrl,
		// impit does not expose a cookie jar interface compatible with our
		// session layer; cookies travel via explicit request headers.
	});

	return {
		async fetchOnce(
			url: string,
			options: FingerprintBackendRequestOptions,
			signal?: AbortSignal,
		): Promise<FingerprintBackendResponse> {
			const response = await impit.fetch(url, {
				method: options.method,
				headers: options.headers,
				redirect: "manual",
				signal,
			});
			return {
				status: response.status,
				statusText: response.statusText,
				headers: headersFromImpit(response.headers),
				body: response.body,
			};
		},
	};
}

export const impitBackendFactory: FingerprintBackendFactory = (key) => makeImpitBackend(key);

function validateImpitProxy(proxy: string | undefined, targetHost: string): string | undefined {
	if (!proxy) {
		return undefined;
	}
	const proxyUrl = validateProxyUrl(proxy);
	if (!isSocksProxyUrl(proxyUrl)) {
		return proxy;
	}

	const targetFamily = isIP(stripIpv6Brackets(hostnameFromKeyHost(targetHost)));
	if (targetFamily === 0) {
		throw new HttpClientError({
			code: "UNSUPPORTED_PROXY_SCHEME",
			phase: "proxy",
			message:
				"SOCKS proxies in fingerprint mode require proxy-side DNS for hostname targets; use mode: 'fast'/'readable' or an HTTP(S) proxy.",
			retryable: false,
		});
	}
	if (proxyUrl.protocol === "socks4:" && targetFamily !== 4) {
		throw new HttpClientError({
			code: "UNSUPPORTED_PROXY_SCHEME",
			phase: "proxy",
			message: "SOCKS4 proxies in fingerprint mode only support IPv4 target URLs.",
			retryable: false,
		});
	}
	return proxy;
}

function hostnameFromKeyHost(host: string): string {
	try {
		return new URL(`https://${host}`).hostname;
	} catch {
		return host;
	}
}

function stripIpv6Brackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function resolveBrowserProfile(profile: string): Browser {
	const mapped = BROWSER_PROFILE_MAP[profile];
	if (!mapped) {
		throw new UnsupportedFingerprintOptionError(
			`browserProfile "${profile}". Known: ${Object.keys(BROWSER_PROFILE_MAP).join(", ")}`,
		);
	}
	return mapped;
}

function headersFromImpit(headers: Headers): Record<string, string | string[]> {
	const out: Record<string, string | string[]> = {};
	const allCookies: string[] = [];
	let hasGetSetCookie = false;
	if (typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function") {
		const cookies = (headers as Headers & { getSetCookie: () => string[] }).getSetCookie();
		if (cookies.length > 0) {
			allCookies.push(...cookies);
			hasGetSetCookie = true;
		}
	}
	for (const [k, v] of headers) {
		if (k.toLowerCase() === "set-cookie") {
			if (!hasGetSetCookie) allCookies.push(v);
		} else {
			out[k] = v;
		}
	}
	if (allCookies.length > 0) out["set-cookie"] = allCookies;
	return out;
}
