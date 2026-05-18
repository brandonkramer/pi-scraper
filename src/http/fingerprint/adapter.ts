/** @file Http fingerprint-adapter module. */
import { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_SECONDS, DEFAULT_USER_AGENT } from "../../defaults.ts";
import type { FetchUrlResult, HttpClientOptions } from "../client.ts";
import { HttpClient } from "../client.ts";
import { normalizeHeaders } from "../download.ts";
import { httpClientErrorFromUnknown } from "../errors.ts";
import { PolitenessController } from "../politeness.ts";
import { followRedirects } from "../redirects.ts";
import { fetchWithRequestPolicy } from "../request-policy.ts";
import { materializeFetchBufferResponse, materializeFetchStreamResponse } from "../response.ts";
import { loadRobotsText, RobotsCache } from "../robots.ts";
import {
	getOrCreateSession,
	mergeSessionHeaders,
	updateSessionCookies,
	type FetchSession,
} from "../session.ts";
import { withTimeout } from "../timeout.ts";
import { assertSafeFetchUrl, UrlSafetyError, type SafeUrlResult } from "../url-safety.ts";
import {
	assertSupportedFingerprintOptions,
	type FingerprintBackendFactory,
	type FingerprintBackendResponse,
	type FingerprintFetchAdapter,
	type FingerprintFetchOptions,
	type FingerprintProfile,
	type FingerprintRequestBackend,
} from "./types.ts";

export class SafeFingerprintAdapter implements FingerprintFetchAdapter {
	private readonly backends = new Map<string, Promise<FingerprintRequestBackend>>();
	private readonly policyClient: HttpClient;
	private readonly politeness: PolitenessController;
	private readonly robots: RobotsCache;

	constructor(
		private readonly factory: FingerprintBackendFactory,
		private readonly profile: FingerprintProfile,
		private readonly clientOptions: HttpClientOptions,
	) {
		this.policyClient = new HttpClient(clientOptions);
		this.politeness = new PolitenessController({
			globalConcurrency: clientOptions.globalConcurrency,
			perHostConcurrency: clientOptions.perHostConcurrency,
		});
		this.robots = new RobotsCache({
			userAgent: clientOptions.userAgent ?? DEFAULT_USER_AGENT,
			fetchText: (url, signal) => loadRobotsText(this.policyClient, url, signal),
		});
	}

	async fetch(
		url: string | URL,
		options: FingerprintFetchOptions = {},
		signal?: AbortSignal,
	): Promise<FetchUrlResult> {
		assertSupportedFingerprintOptions({ ...this.profile, ...options });
		if (this.clientOptions.fingerprintTrustLevel === "untrusted") {
			throw new UrlSafetyError(
				"FINGERPRINT_UNTRUSTED_URL",
				"mode: fingerprint cannot fully prevent DNS rebinding for untrusted URLs. Use mode: 'browser' or set fingerprintTrustLevel: 'trusted'.",
				url.toString(),
			);
		}
		const initialSafe = await assertSafeFetchUrl(url, this.clientOptions);
		try {
			return await followRedirects({
				initialSafe,
				maxRedirects: options.maxRedirects ?? this.clientOptions.maxRedirects ?? 5,
				fetchRequest: (safe) =>
					fetchWithRequestPolicy({
						safe,
						respectRobots: options.respectRobots,
						robots: this.robots,
						politeness: this.politeness,
						userAgent: this.clientOptions.userAgent ?? DEFAULT_USER_AGENT,
						signal,
						fetch: () => this.fetchOnce(safe, options, signal),
					}),
				resolveSafeUrl: (nextUrl) => assertSafeFetchUrl(nextUrl, this.clientOptions),
			});
		} catch (error) {
			throw fingerprintFetchError(error, initialSafe.normalizedUrl, options);
		}
	}

	private async fetchOnce(
		safe: SafeUrlResult,
		options: FingerprintFetchOptions,
		parentSignal: AbortSignal | undefined,
	): Promise<FetchUrlResult> {
		const timeoutMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;
		const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		const { signal, cleanup } = withTimeout(parentSignal, timeoutMs);
		try {
			const backend = await this.backendFor(safe.url.host);
			const secondSafe = await revalidateDns(safe, this.clientOptions);

			// Load session and merge cookies into outgoing headers
			const session = options.sessionId
				? await getOrCreateSession(options.sessionId, this.clientOptions.storage)
				: undefined;
			const baseHeaders = browserHeaders(
				this.clientOptions.userAgent ?? DEFAULT_USER_AGENT,
				options.headers,
			);
			const mergedHeaders = session
				? mergeSessionHeaders(
						session,
						safe.url.hostname,
						safe.url.pathname,
						safe.url.protocol === "https:" ? "https" : "http",
						baseHeaders,
					)
				: baseHeaders;

			const response = await backend.fetchOnce(
				safe.normalizedUrl,
				{
					method: options.method === "HEAD" ? "HEAD" : "GET",
					headers: mergedHeaders,
					timeoutMs,
					maxBytes,
					browserProfile: options.browserProfile ?? this.profile.browserProfile ?? "chrome",
					osProfile: options.osProfile ?? this.profile.osProfile ?? "default",
				},
				signal,
			);
			const result = await materializeBackendResponse(
				safe.normalizedUrl,
				response,
				options,
				maxBytes,
			);

			// Persist Set-Cookie back to session
			if (session && response.headers) {
				setCookiesFromResponse(session, response.headers, safe.url);
			}

			result.diagnostics = {
				fingerprintRebindingMitigation: {
					strategy: "double-resolve",
					preflightAddresses: safe.checkedAddresses,
					connectAddresses: secondSafe?.checkedAddresses ?? [],
				},
			};
			return result;
		} finally {
			cleanup();
		}
	}

	private backendFor(host: string): Promise<FingerprintRequestBackend> {
		const key = JSON.stringify({
			browserProfile: this.profile.browserProfile ?? "chrome",
			osProfile: this.profile.osProfile ?? "default",
			proxy: this.profile.proxy,
			host,
		});
		const existing = this.backends.get(key);
		if (existing) return existing;

		const backend = Promise.resolve(
			this.factory({
				browserProfile: this.profile.browserProfile ?? "chrome",
				osProfile: this.profile.osProfile ?? "default",
				proxy: this.profile.proxy,
				host,
			}),
		);
		this.backends.set(key, backend);
		return backend;
	}
}

export async function materializeBackendResponse(
	url: string,
	response: FingerprintBackendResponse,
	options: FingerprintFetchOptions,
	maxBytes: number,
): Promise<FetchUrlResult> {
	const headers = normalizeHeaders(response.headers ?? {});
	if (response.body && typeof response.body === "object" && "getReader" in response.body) {
		return await materializeFetchStreamResponse({
			url,
			status: response.status,
			statusText: response.statusText,
			headers,
			body: response.body as unknown as AsyncIterable<Uint8Array>,
			maxBytes,
			options,
			discardBody: async () => {
				await (response.body as ReadableStream<Uint8Array>).cancel();
			},
		});
	}
	const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? "");
	return await materializeFetchBufferResponse({
		url,
		status: response.status,
		statusText: response.statusText,
		headers,
		body,
		maxBytes,
		options,
	});
}

async function revalidateDns(
	safe: SafeUrlResult,
	options: HttpClientOptions,
): Promise<SafeUrlResult | undefined> {
	if (safe.checkedAddresses.length === 0) return undefined;
	const second = await assertSafeFetchUrl(safe.normalizedUrl, options);
	if (second.checkedAddresses.length === 0) return second;

	const firstSet = new Set(safe.checkedAddresses);
	const secondSet = new Set(second.checkedAddresses);
	if (firstSet.size !== secondSet.size || ![...firstSet].every((ip) => secondSet.has(ip))) {
		throw new UrlSafetyError(
			"DNS_REBINDING_DETECTED",
			`DNS resolved to different IPs between preflight (${[...firstSet].join(", ")}) and connect-time (${[...secondSet].join(", ")}) check. Potential DNS rebinding attack.`,
			safe.normalizedUrl,
		);
	}
	return second;
}

function fingerprintFetchError(error: unknown, url: string, options: FingerprintFetchOptions) {
	return httpClientErrorFromUnknown(error, url, options, {
		code: "FINGERPRINT_FETCH_FAILED",
		phase: "fingerprint",
		message: "Fingerprint fetch failed",
	});
}

function browserHeaders(
	userAgent: string,
	headers: Record<string, string> = {},
): Record<string, string> {
	return {
		"user-agent": userAgent,
		accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"accept-language": "en-US,en;q=0.9",
		"upgrade-insecure-requests": "1",
		...headers,
	};
}

/** @internal exported for testing only */
export function setCookiesFromResponse(
	session: FetchSession,
	headers: Record<string, string | string[] | undefined>,
	url: URL,
): void {
	const raw = headers["set-cookie"];
	if (!raw) return;
	const cookies = Array.isArray(raw) ? raw : [raw];
	updateSessionCookies(session, cookies, url.hostname, url.pathname);
}
