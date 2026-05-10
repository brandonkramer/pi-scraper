/**
 * @fileoverview Pattern inspection error class.
 */
import type { StructuredError } from "../../types.ts";

export class PatternInspectError extends Error {
	readonly structured: StructuredError;

	constructor(message: string, code = "PATTERN_INPUT_INVALID", url?: string) {
		super(message);
		this.name = "PatternInspectError";
		this.structured = {
			code,
			phase: "pattern_extract",
			message,
			retryable: false,
			url,
		};
	}
}
