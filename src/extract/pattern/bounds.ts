/**
 * @fileoverview Shared pattern inspection utilities.
 */
import { PatternInspectError } from "./errors.ts";

export function boundedInteger(value: number, min: number, max: number): number {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new PatternInspectError(
			`Expected integer between ${min} and ${max}.`,
			"PATTERN_LIMIT_EXCEEDED",
		);
	}
	return value;
}

export function withGlobalFlag(flags: string): string {
	return Array.from(new Set(`${flags}g`.split(""))).join("");
}
