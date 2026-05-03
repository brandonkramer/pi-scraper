import { request, type Dispatcher } from "undici";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_RESPECT_ROBOTS,
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_USER_AGENT,
} from "../defaults.js";
import type { CommonRequestOptions } from "../types.js";
import { BodySizeLimitError, collectBody, isTextLikeContentType, streamToTempFile, type BinaryDownloadMetadata } from "./download.js";
import { HttpClientError } from "./errors.js";
import { createDefaultDispatcher } from "./guarded-agent.js";
import { PolitenessController, abortableSleep } from "./politeness.js";
import { redirectError, isRedirectStatus, resolveRedirectUrl } from "./redirects.js";
import { hasStructuredError, isRetryableStatus, retryDelayMs, shouldStopRetrying } from "./retry.js";
import { RobotsCache, RobotsDeniedError } from "./robots.js";
import { decodeText } from "./text-decode.js";
import { withTimeout } from "./timeout.js";
import { assertSafeFetchUrl, type SafeUrlResult, type UrlSafetyOptions } from "./url-safety.js";

export { HttpClientError } from "./errors.js";

export interface HttpClientOptions extends UrlSafetyOptions {
  dispatcher?: Dispatcher;
  userAgent?: string;
  globalConcurrency?: number;
  perHostConcurrency?: number;
  retryAttempts?: number;
  maxRedirects?: number;
}

export interface FetchUrlOptions extends CommonRequestOptions {
  method?: "GET" | "HEAD";
  downloadBinary?: boolean;
  forceText?: boolean;
  maxRedirects?: number;
}

export interface FetchUrlResult {
  /** Normalized original request URL after URL policy canonicalization, not the verbatim input string. */
  url: string;
  /** Normalized URL of the response actually fetched after HTTP redirects. */
  finalUrl: string;
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  contentType?: string;
  body?: Buffer;
  text?: string;
  file?: BinaryDownloadMetadata;
  downloadedBytes: number;
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

  async fetchUrl(input: string | URL, fetchOptions: FetchUrlOptions = {}, signal?: AbortSignal): Promise<FetchUrlResult> {
    const safe = await assertSafeFetchUrl(input, this.options);
    try {
      return await this.fetchWithRetries(safe, fetchOptions, signal, true);
    } catch (error) {
      if (error instanceof HttpClientError) {
        throw error;
      }
      throw this.toClientError(error, safe.normalizedUrl, fetchOptions);
    }
  }

  private async fetchRobotsText(url: string, signal?: AbortSignal): Promise<{ status: number; text: string }> {
    const safe = await assertSafeFetchUrl(url, this.options);
    const result = await this.fetchWithRetries(safe, {
      respectRobots: false,
      timeoutSeconds: 5,
      maxBytes: 256 * 1024,
      headers: { accept: "text/plain,*/*;q=0.1" },
      forceText: true,
    }, signal, false);
    return { status: result.status, text: result.text ?? result.body?.toString("utf8") ?? "" };
  }

  private async fetchWithRetries(
    initialSafe: SafeUrlResult,
    options: FetchUrlOptions,
    signal: AbortSignal | undefined,
    applyPolicy: boolean,
  ): Promise<FetchUrlResult> {
    const attempts = options.method === "HEAD" ? 1 : (this.options.retryAttempts ?? DEFAULT_RETRY.attempts);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await this.fetchWithRedirects(initialSafe, options, signal, applyPolicy);
        if (attempt < attempts && isRetryableStatus(result.status)) {
          await abortableSleep(retryDelayMs(attempt, result.headers["retry-after"]), signal);
          continue;
        }
        return result;
      } catch (error) {
        lastError = error;
        if (shouldStopRetrying(error, signal, attempt, attempts, isHttpClientError)) {
          throw this.toClientError(error, initialSafe.normalizedUrl, options);
        }
        await abortableSleep(retryDelayMs(attempt), signal);
      }
    }

    throw this.toClientError(lastError, initialSafe.normalizedUrl, options);
  }

  private async fetchWithRedirects(
    initialSafe: SafeUrlResult,
    options: FetchUrlOptions,
    signal: AbortSignal | undefined,
    applyPolicy: boolean,
  ): Promise<FetchUrlResult> {
    const maxRedirects = options.maxRedirects ?? this.options.maxRedirects ?? 5;
    const initialUrl = initialSafe.normalizedUrl;
    const visited = new Set<string>([initialUrl]);
    let currentSafe = initialSafe;

    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const result = await this.fetchOneRequest(currentSafe, options, signal, applyPolicy);
      if (!isRedirectStatus(result.status) || !result.headers.location) {
        return { ...result, url: initialUrl, finalUrl: currentSafe.normalizedUrl };
      }

      if (redirects >= maxRedirects) {
        throw redirectError("REDIRECT_LIMIT", `Redirect limit exceeded at ${currentSafe.normalizedUrl}`, initialUrl, currentSafe.normalizedUrl);
      }

      const next = await assertSafeFetchUrl(resolveRedirectUrl(result.headers.location, currentSafe.normalizedUrl), this.options);
      if (visited.has(next.normalizedUrl)) {
        throw redirectError("REDIRECT_LOOP", `Redirect loop detected at ${next.normalizedUrl}`, initialUrl, currentSafe.normalizedUrl);
      }
      visited.add(next.normalizedUrl);
      currentSafe = next;
    }

    throw redirectError("REDIRECT_LIMIT", `Redirect limit exceeded at ${currentSafe.normalizedUrl}`, initialUrl, currentSafe.normalizedUrl);
  }

  private async fetchOneRequest(
    safe: SafeUrlResult,
    options: FetchUrlOptions,
    signal: AbortSignal | undefined,
    applyPolicy: boolean,
  ): Promise<FetchUrlResult> {
    // `safe` is produced once for the initial request and once per redirect hop.
    // Reusing it avoids duplicate DNS preflight work while the guarded Undici
    // dispatcher remains the authoritative connect-time SSRF check.
    if (!applyPolicy) {
      return await this.fetchOnce(safe.normalizedUrl, options, signal);
    }

    const respectRobots = options.respectRobots ?? DEFAULT_RESPECT_ROBOTS;
    const robotsRules = respectRobots ? await this.robots.assertAllowed(safe.normalizedUrl, signal) : undefined;
    const crawlDelayMs = robotsRules?.crawlDelay(this.userAgent);
    return await this.politeness.run(safe.url.host, crawlDelayMs, signal, () =>
      this.fetchOnce(safe.normalizedUrl, options, signal),
    );
  }

  private async fetchOnce(url: string, options: FetchUrlOptions, parentSignal?: AbortSignal): Promise<FetchUrlResult> {
    const timeoutMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const { signal, cleanup } = withTimeout(parentSignal, timeoutMs);
    try {
      const response = await request(url, {
        method: options.method ?? "GET",
        dispatcher: this.dispatcher,
        headers: buildHeaders(this.userAgent, options.headers),
        signal,
      });
      const responseHeaders = normalizeHeaders(response.headers);
      enforceContentLength(responseHeaders["content-length"], maxBytes);
      const contentType = responseHeaders["content-type"];

      if (options.method === "HEAD") {
        await response.body.dump();
        return baseResult(url, response.statusCode, undefined, responseHeaders, contentType, 0);
      }

      if (options.downloadBinary === true || (options.forceText !== true && !isTextLikeContentType(contentType))) {
        const file = await streamToTempFile(response.body, { maxBytes, contentType });
        return { ...baseResult(url, response.statusCode, undefined, responseHeaders, contentType, file.downloadedBytes), file };
      }

      const collected = await collectBody(response.body, maxBytes);
      return {
        ...baseResult(url, response.statusCode, undefined, responseHeaders, contentType, collected.downloadedBytes),
        body: collected.buffer,
        text: decodeText(collected.buffer, contentType),
      };
    } finally {
      cleanup();
    }
  }

  private toClientError(error: unknown, url: string, options: FetchUrlOptions): HttpClientError {
    if (error instanceof HttpClientError) {
      return error;
    }
    if (hasStructuredError(error)) {
      return new HttpClientError(error.structured, error);
    }
    if (error instanceof RobotsDeniedError) {
      return new HttpClientError({ code: "ROBOTS_DENIED", phase: "robots", message: error.message, retryable: false, url });
    }
    if (error instanceof BodySizeLimitError) {
      return new HttpClientError({
        code: "MAX_BYTES_EXCEEDED",
        phase: "download",
        message: error.message,
        retryable: false,
        downloadedBytes: error.downloadedBytes,
        timeoutMs: (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000,
        url,
      }, error);
    }
    const aborted = error instanceof Error && error.name === "AbortError";
    return new HttpClientError({
      code: aborted ? "ABORTED" : "HTTP_FETCH_FAILED",
      phase: "fetch",
      message: error instanceof Error ? error.message : "HTTP fetch failed",
      retryable: !aborted,
      timeoutMs: (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000,
      url,
      cause: error,
    }, error);
  }
}

export function createHttpClient(options?: HttpClientOptions): HttpClient {
  return new HttpClient(options);
}

function isHttpClientError(error: unknown): error is HttpClientError {
  return error instanceof HttpClientError;
}

function buildHeaders(userAgent: string, headers: Record<string, string> = {}): Record<string, string> {
  return { "user-agent": userAgent, accept: "*/*", ...headers };
}

function baseResult(url: string, status: number, statusText: string | undefined, headers: Record<string, string>, contentType: string | undefined, downloadedBytes: number): FetchUrlResult {
  return { url, finalUrl: url, status, statusText, headers, contentType, downloadedBytes };
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = value.join(", ");
    } else if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

function enforceContentLength(contentLength: string | undefined, maxBytes: number): void {
  const length = contentLength ? Number.parseInt(contentLength, 10) : Number.NaN;
  if (Number.isFinite(length) && length > maxBytes) {
    throw new BodySizeLimitError(maxBytes, length);
  }
}
