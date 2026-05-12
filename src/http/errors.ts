/** @file Shared structured error carriers for HTTP-adjacent workflows. */
import { DEFAULT_TIMEOUT_SECONDS } from "../defaults.ts";
import type { StructuredError } from "../types.ts";
import { BodySizeLimitError } from "./download.ts";
import { RobotsDeniedError } from "./robots.ts";

export interface StructuredErrorCarrier extends Error {
	structured: StructuredError;
}

export class HttpClientError extends Error {
	constructor(
		readonly structured: StructuredError,
		cause?: unknown,
	) {
		super(structured.message);
		this.name = "HttpClientError";
		this.cause = cause;
	}
}

export function createStructuredError(
	structured: StructuredError,
	name = "StructuredError",
): StructuredErrorCarrier {
	const error = new Error(structured.message) as StructuredErrorCarrier;
	error.name = name;
	error.structured = structured;
	error.cause = structured.cause;
	return error;
}

export function structuredErrorFromUnknown(
	error: unknown,
	fallback: Omit<StructuredError, "message" | "retryable"> & {
		message: string;
		retryable?: boolean;
	},
): StructuredError {
	if (hasStructuredError(error)) return error.structured;
	return {
		...fallback,
		message: error instanceof Error ? error.message : fallback.message,
		retryable: fallback.retryable ?? false,
		cause: error,
	};
}

export interface HttpClientErrorOptions {
	timeoutSeconds?: number;
}

export function httpClientErrorFromUnknown(
	error: unknown,
	url: string,
	options: HttpClientErrorOptions,
	fallback: { code: string; phase: string; message: string },
): HttpClientError {
	const safeUrl = redactQuery(url);
	if (error instanceof HttpClientError) return error;
	if (hasStructuredError(error)) return new HttpClientError(error.structured, error);
	if (error instanceof RobotsDeniedError) {
		return new HttpClientError({
			code: "ROBOTS_DENIED",
			phase: "robots",
			message: error.message,
			retryable: false,
			url: safeUrl,
		});
	}
	if (error instanceof BodySizeLimitError) {
		return new HttpClientError(
			{
				code: "MAX_BYTES_EXCEEDED",
				phase: "download",
				message: error.message,
				retryable: false,
				downloadedBytes: error.downloadedBytes,
				timeoutMs: timeoutMs(options),
				url: safeUrl,
			},
			error,
		);
	}
	const aborted = error instanceof Error && error.name === "AbortError";
	return new HttpClientError(
		{
			code: aborted ? "ABORTED" : fallback.code,
			phase: fallback.phase,
			message: error instanceof Error ? error.message : fallback.message,
			retryable: !aborted,
			timeoutMs: timeoutMs(options),
			url: safeUrl,
			cause: error,
		},
		error,
	);
}

/**
 * Best-effort URL redaction: strips query, fragment, and auth credentials. Malformed URLs are
 * returned verbatim — the caller is already on an error path.
 */
function redactQuery(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.username = "";
		parsed.password = "";
		if (parsed.search) parsed.search = "?<_redacted_>";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return url;
	}
}

export function hasStructuredError(error: unknown): error is { structured: StructuredError } {
	if (!error || typeof error !== "object") return false;
	const structured = (error as { structured?: unknown }).structured;
	return Boolean(
		structured &&
		typeof structured === "object" &&
		typeof (structured as { code?: unknown }).code === "string" &&
		typeof (structured as { message?: unknown }).message === "string",
	);
}

function timeoutMs(options: HttpClientErrorOptions): number {
	return (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;
}
