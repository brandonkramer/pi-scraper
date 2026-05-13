/** @file Impit backend for mode: "fingerprint". */

import { Impit, type Browser } from "impit";

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
	const ImpitCtor = (createImpit ?? Impit) as ImpitConstructor;
	const impit = new ImpitCtor({
		browser: browserName,
		followRedirects: false,
		maxRedirects: 0,
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

function resolveBrowserProfile(profile: string): Browser {
	const mapped = BROWSER_PROFILE_MAP[profile];
	if (!mapped) {
		throw new UnsupportedFingerprintOptionError(
			`browserProfile "${profile}". Known: ${Object.keys(BROWSER_PROFILE_MAP).join(", ")}`,
		);
	}
	return mapped;
}

function headersFromImpit(headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of headers) {
		out[k] = v;
	}
	return out;
}
