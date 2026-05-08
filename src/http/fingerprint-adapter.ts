/**
 * @fileoverview http fingerprint-adapter module.
 */
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_TIMEOUT_SECONDS,
	DEFAULT_USER_AGENT,
} from "../defaults.js";
import type { FetchUrlResult, HttpClientOptions } from "./client.js";
import { HttpClient } from "./client.js";
import { normalizeHeaders } from "./download.js";
import { httpClientErrorFromUnknown } from "./errors.js";
import {
	assertSupportedFingerprintOptions,
	type FingerprintBackendFactory,
	type FingerprintBackendResponse,
	type FingerprintFetchAdapter,
	type FingerprintFetchOptions,
	type FingerprintProfile,
	type FingerprintRequestBackend,
} from "./fingerprint-types.js";
import { PolitenessController } from "./politeness.js";
import { followRedirects } from "./redirects.js";
import { fetchWithRequestPolicy } from "./request-policy.js";
import { loadRobotsText, RobotsCache } from "./robots.js";
import { materializeFetchBufferResponse } from "./response.js";
import { withTimeout } from "./timeout.js";
import { assertSafeFetchUrl, type SafeUrlResult } from "./url-safety.js";

export class SafeFingerprintAdapter implements FingerprintFetchAdapter {
	private readonly backends = new Map<
		string,
		Promise<FingerprintRequestBackend>
	>();
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
			fetchText: (url, signal) =>
				loadRobotsText(this.policyClient, url, signal),
		});
	}

	async fetch(
		url: string | URL,
		options: FingerprintFetchOptions = {},
		signal?: AbortSignal,
	): Promise<FetchUrlResult> {
		assertSupportedFingerprintOptions({ ...this.profile, ...options });
		const initialSafe = await assertSafeFetchUrl(url, this.clientOptions);
		try {
			return await followRedirects({
				initialSafe,
				maxRedirects:
					options.maxRedirects ?? this.clientOptions.maxRedirects ?? 5,
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
				resolveSafeUrl: (nextUrl) =>
					assertSafeFetchUrl(nextUrl, this.clientOptions),
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
		const timeoutMs =
			(options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;
		const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		const { signal, cleanup } = withTimeout(parentSignal, timeoutMs);
		try {
			const backend = await this.backendFor(safe.url.host);
			const response = await backend.fetchOnce(
				safe.normalizedUrl,
				{
					method: options.method === "HEAD" ? "HEAD" : "GET",
					headers: browserHeaders(
						this.clientOptions.userAgent ?? DEFAULT_USER_AGENT,
						options.headers,
					),
					timeoutMs,
					maxBytes,
					browserProfile:
						options.browserProfile ?? this.profile.browserProfile ?? "chrome",
					osProfile: options.osProfile ?? this.profile.osProfile ?? "default",
				},
				signal,
			);
			return await materializeBackendResponse(
				safe.normalizedUrl,
				response,
				options,
				maxBytes,
			);
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

async function materializeBackendResponse(
	url: string,
	response: FingerprintBackendResponse,
	options: FingerprintFetchOptions,
	maxBytes: number,
): Promise<FetchUrlResult> {
	const headers = normalizeHeaders(response.headers ?? {});
	const body = Buffer.isBuffer(response.body)
		? response.body
		: Buffer.from(response.body ?? "");
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

function fingerprintFetchError(
	error: unknown,
	url: string,
	options: FingerprintFetchOptions,
) {
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
