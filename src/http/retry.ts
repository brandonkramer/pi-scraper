/**
 * @fileoverview http retry module.
 */
import { DEFAULT_RETRY } from "../defaults.js";
import type { CommonRequestOptions } from "../types.js";
import { BodySizeLimitError } from "./download.js";
import { hasStructuredError, type HttpClientError } from "./errors.js";
import { RobotsDeniedError } from "./robots.js";

export function isRetryableStatus(status: number): boolean {
	return [408, 429, 500, 502, 503, 504].includes(status);
}

export function shouldStopRetrying(
	error: unknown,
	signal: AbortSignal | undefined,
	attempt: number,
	attempts: number,
	isClientError: (error: unknown) => error is HttpClientError,
): boolean {
	return (
		error instanceof RobotsDeniedError ||
		error instanceof BodySizeLimitError ||
		(isClientError(error) && error.structured.retryable === false) ||
		(hasStructuredError(error) && error.structured.retryable === false) ||
		signal?.aborted === true ||
		attempt >= attempts
	);
}

export function isIdempotentMethod(method: string | undefined): boolean {
	return method === undefined || method === "GET" || method === "HEAD";
}

export function retryDelayMs(
	attempt: number,
	retryAfter?: string,
	options: CommonRequestOptions = {},
): number {
	const retryAfterMs = parseRetryAfter(retryAfter);
	if (retryAfterMs !== undefined) {
		return retryAfterMs;
	}
	const baseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
	const maxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
	const jitterMs = options.retryJitterMs ?? DEFAULT_RETRY.jitterMs;
	const base = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
	return Math.round(base + Math.random() * jitterMs);
}

export function parseRetryAfterMs(
	value: string | undefined,
): number | undefined {
	return parseRetryAfter(value);
}

export { hasStructuredError } from "./errors.js";

function parseRetryAfter(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const seconds = Number.parseInt(value, 10);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1_000);
	}
	const dateMs = Date.parse(value);
	return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}
