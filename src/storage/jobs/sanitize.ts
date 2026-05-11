/** @file Job parameter sanitization — strips secret keys from persisted params. */
import { isUnknownRecord } from "../../types.ts";

const SECRET_KEY_PATTERN =
	/(authorization|cookie|cookies|token|api[-_]?key|password|passwd|secret|proxy|headers)/iu;

export function sanitizeJobParams(value: unknown): Record<string, unknown> {
	const sanitized = sanitizeValue(value, 0);
	return isUnknownRecord(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
	if (depth > 4) return "[truncated]";
	if (value === null || value === undefined) return value;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return value;
	if (Array.isArray(value))
		return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
	if (!isUnknownRecord(value)) return;
	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (SECRET_KEY_PATTERN.test(key)) continue;
		if (typeof entry === "function" || typeof entry === "symbol") continue;
		output[key] = sanitizeValue(entry, depth + 1);
	}
	return output;
}
