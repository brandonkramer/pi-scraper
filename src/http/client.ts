/**
 * @fileoverview http client module.
 */
import {
	getOrCreateSession,
	mergeSessionHeaders,
	updateSessionCookies,
} from "./session.ts";
import { request, type Dispatcher } from "undici";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_RETRY,
	DEFAULT_TIMEOUT_SECONDS,
	DEFAULT_USER_AGENT,
} from "../defaults.ts";
import type { CommonRequestOptions } from "../types.ts";
import { normalizeHeaders } from "./download.ts";
import { HttpClientError, httpClientErrorFromUnknown } from "./errors.ts";
import { createDefaultDispatcher } from "./guarded-agent.ts";
import { PolitenessController, abortableSleep } from "./politeness.ts";
import { followRedirects } from "./redirects.ts";
import { fetchWithRequestPolicy } from "./request-policy.ts";
import {
	isRetryableStatus,
	isIdempotentMethod,
	parseRetryAfterMs,
	retryDelayMs,
	shouldStopRetrying,
} from "./retry.ts";
import { RobotsCache } from "./robots.ts";
import {
	materializeFetchStreamResponse,
	type FetchUrlResult,
} from "./response.ts";
import { withTimeout } from "./timeout.ts";
import { findFreshFetch, recordFetch } from "../storage/cache.ts";
import type { ResolveStorageOptions } from "../storage/paths.ts";
import {
	assertSafeFetchUrl,
	type SafeUrlResult,
	type UrlSafetyOptions,
} from "./url-safety.ts";

export { HttpClientError } from "./errors.ts";
export { createFetchUrlResult } from "./response.ts";
export type { FetchUrlResult } from "./response.ts";

export interface HttpClientOptions extends UrlSafetyOptions {
	dispatcher?: Dispatcher;
	userAgent?: string;
	globalConcurrency?: number;
	perHostConcurrency?: number;
	retryAttempts?: number;
	maxRedirects?: number;
	storage?: ResolveStorageOptions;
}

export interface FetchUrlOptions extends CommonRequestOptions {
	method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
	downloadBinary?: boolean;
	forceText?: boolean;
	maxRedirects?: number;
	sessionId?: string;
	cookies?: Record<string, string>;
}

export class HttpClient {
	private readonly dispatcher: Dispatcher;
	private readonly userAgent: string;
	private readonly politeness: PolitenessController;
	private readonly robots: RobotsCache;

	constructor(private readonly options: HttpClientOptions = {}) {
		this.dispatcher = options.dispatcher ?? createDefaultDispatcher(options);
		this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
		this.politeness = new PolitenessController({
			globalConcurrency: options.globalConcurrency,
			perHostConcurrency: options.perHostConcurrency,
		});
		this.robots = new RobotsCache({
			userAgent: this.userAgent,
			fetchText: (url, signal) => this.fetchRobotsText(url, signal),
		});
	}

	private async safeFetchUrl(input: string | URL): Promise<SafeUrlResult> {
		return await assertSafeFetchUrl(input, {
			...this.options,
			trimTrailingSlash: false,
		});
	}

	async fetchUrl(
		input: string | URL,
		fetchOptions: FetchUrlOptions = {},
		signal?: AbortSignal,
	): Promise<FetchUrlResult> {
		const safe = await this.safeFetchUrl(input);
		try {
			const ttl = fetchOptions.cacheTtlSeconds;
			if (
				fetchOptions.method !== "HEAD" &&
				ttl &&
				ttl > 0 &&
				fetchOptions.refresh !== true
			) {
				const hit = await findFreshFetch(safe.normalizedUrl, ttl, {
					...this.options.storage,
					maxAgeSeconds: fetchOptions.maxAgeSeconds,
				});
				if (hit) return hit;
			}
			const result = await this.fetchWithRetries(
				safe,
				fetchOptions,
				signal,
				true,
			);
			if (fetchOptions.method !== "HEAD" && ttl && ttl > 0) {
				await recordFetch(result, { ...this.options.storage, ttlSeconds: ttl });
			}
			return { ...result, cache: { cached: false, stale: false } };
		} catch (error) {
			if (error instanceof HttpClientError) {
				throw error;
			}
			throw httpFetchError(error, safe.normalizedUrl, fetchOptions);
		}
	}

	private async fetchRobotsText(
		url: string,
		signal?: AbortSignal,
	): Promise<{ status: number; text: string }> {
		const safe = await this.safeFetchUrl(url);
		const result = await this.fetchWithRetries(
			safe,
			{
				respectRobots: false,
				timeoutSeconds: 5,
				maxBytes: 256 * 1024,
				headers: { accept: "text/plain,*/*;q=0.1" },
				forceText: true,
			},
			signal,
			false,
		);
		return {
			status: result.status,
			text: result.text ?? result.body?.toString("utf8") ?? "",
		};
	}

	private async fetchWithRetries(
		initialSafe: SafeUrlResult,
		options: FetchUrlOptions,
		signal: AbortSignal | undefined,
		applyPolicy: boolean,
	): Promise<FetchUrlResult> {
		const attempts = isIdempotentMethod(options.method)
			? (options.retryAttempts ??
				this.options.retryAttempts ??
				DEFAULT_RETRY.attempts)
			: 1;
		let lastError: unknown;

		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				const result = await followRedirects({
					initialSafe,
					maxRedirects: options.maxRedirects ?? this.options.maxRedirects ?? 5,
					fetchRequest: (safe) =>
						fetchWithRequestPolicy({
							safe,
							respectRobots: options.respectRobots,
							applyPolicy,
							robots: this.robots,
							politeness: this.politeness,
							userAgent: this.userAgent,
							signal,
							fetch: () => this.fetchOnce(safe.normalizedUrl, options, signal),
						}),
					resolveSafeUrl: (url) => this.safeFetchUrl(url),
				});
				this.politeness.noteResponse(
					new URL(result.finalUrl).host,
					result.status,
					parseRetryAfterMs(result.headers["retry-after"]),
				);
				if (attempt < attempts && isRetryableStatus(result.status)) {
					await abortableSleep(
						retryDelayMs(attempt, result.headers["retry-after"], options),
						signal,
					);
					continue;
				}
				return result;
			} catch (error) {
				lastError = error;
				if (
					shouldStopRetrying(
						error,
						signal,
						attempt,
						attempts,
						(value): value is HttpClientError =>
							value instanceof HttpClientError,
					)
				) {
					throw httpFetchError(error, initialSafe.normalizedUrl, options);
				}
				await abortableSleep(retryDelayMs(attempt, undefined, options), signal);
			}
		}

		throw httpFetchError(lastError, initialSafe.normalizedUrl, options);
	}

	private async fetchOnce(
		url: string,
		options: FetchUrlOptions,
		parentSignal?: AbortSignal,
	): Promise<FetchUrlResult> {
		const timeoutMs =
			(options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;
		const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		const { signal, cleanup } = withTimeout(parentSignal, timeoutMs);

		// Session support: load cookies for this request
		const session = options.sessionId
			? await getOrCreateSession(options.sessionId, this.options.storage)
			: undefined;
		const urlObj = new URL(url);
		const cookieHeader = options.cookies
			? Object.entries(options.cookies)
					.map(([name, value]) => `${name}=${value}`)
					.join("; ")
			: "";
		const mergedHeaders = mergeSessionHeaders(
			session,
			urlObj.hostname,
			urlObj.pathname,
			options.headers,
		);
		if (cookieHeader) {
			mergedHeaders["cookie"] = mergedHeaders["cookie"]
				? `${mergedHeaders["cookie"]}; ${cookieHeader}`
				: cookieHeader;
		}

		try {
			const response = await request(url, {
				method: options.method ?? "GET",
				dispatcher: this.dispatcher,
				headers: {
					"user-agent": this.userAgent,
					accept: "*/*",
					...mergedHeaders,
				},
				signal,
			});
			const result = await materializeFetchStreamResponse({
				url,
				status: response.statusCode,
				headers: normalizeHeaders(response.headers),
				body: response.body,
				maxBytes,
				options,
				discardBody: () => response.body.dump(),
			});

			// Update session cookies from Set-Cookie headers
			if (session) {
				const setCookie = result.headers["set-cookie"];
				if (setCookie) {
					updateSessionCookies(
						session,
						Array.isArray(setCookie) ? setCookie : [setCookie],
						urlObj.hostname,
					);
				}
			}

			return result;
		} finally {
			cleanup();
		}
	}
}

export function createHttpClient(options?: HttpClientOptions): HttpClient {
	return new HttpClient(options);
}

function httpFetchError(
	error: unknown,
	url: string,
	options: FetchUrlOptions,
): HttpClientError {
	return httpClientErrorFromUnknown(error, url, options, {
		code: "HTTP_FETCH_FAILED",
		phase: "fetch",
		message: "HTTP fetch failed",
	});
}
