/**
 * @fileoverview Structured error → JobError mapping helpers.
 */
import { isUnknownRecord, type StructuredError } from "../../types.ts";

export interface JobError {
	url?: string;
	phase: string;
	code: string;
	message: string;
}

export function structuredErrorToJobError(error: StructuredError): JobError {
	return {
		url: error.url ?? error.finalUrl,
		phase: error.phase,
		code: error.code,
		message: error.message,
	};
}

export function unknownToJobError(
	error: unknown,
	phase: string,
	url?: string,
): JobError {
	if (isUnknownRecord(error) && "structured" in error) {
		return structuredErrorToJobError(error.structured as StructuredError);
	}
	return {
		url,
		phase,
		code: error instanceof Error ? error.name : "JOB_ERROR",
		message: error instanceof Error ? error.message : "Job failed",
	};
}

export function appendJobError(
	errors: readonly JobError[],
	error: JobError,
): JobError[] {
	return [...errors, error].slice(-50);
}
