/**
 * @fileoverview Shared structured error carriers for HTTP-adjacent workflows.
 */
import type { StructuredError } from "../types.js";

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

export function hasStructuredError(
	error: unknown,
): error is { structured: StructuredError } {
	if (!error || typeof error !== "object") return false;
	const structured = (error as { structured?: unknown }).structured;
	return Boolean(
		structured &&
			typeof structured === "object" &&
			typeof (structured as { code?: unknown }).code === "string" &&
			typeof (structured as { message?: unknown }).message === "string",
	);
}
