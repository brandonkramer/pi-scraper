import { DEFAULT_RETRY } from "../defaults.js";
import type { StructuredError } from "../types.js";
import { BodySizeLimitError } from "./download.js";
import type { HttpClientError } from "./errors.js";
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
  return error instanceof RobotsDeniedError ||
    error instanceof BodySizeLimitError ||
    isClientError(error) && error.structured.retryable === false ||
    hasStructuredError(error) && error.structured.retryable === false ||
    signal?.aborted === true ||
    attempt >= attempts;
}

export function retryDelayMs(attempt: number, retryAfter?: string): number {
  const retryAfterMs = parseRetryAfter(retryAfter);
  if (retryAfterMs !== undefined) {
    return retryAfterMs;
  }
  const base = Math.min(DEFAULT_RETRY.maxDelayMs, DEFAULT_RETRY.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(base / 2 + Math.random() * base / 2);
}

export function hasStructuredError(error: unknown): error is { structured: StructuredError } {
  return typeof error === "object" && error !== null && "structured" in error;
}

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
