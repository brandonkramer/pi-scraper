/**
 * @file Safe, deterministic JSONPath subset for pattern extraction. Supported syntax:
 *
 *   - Root `$`
 *   - Object properties via `.name`
 *   - Array wildcard `[*]`
 *   - Array index `[0]`, `[n]` Forbidden: filters, script expressions, recursive descent (`..`),
 *     slices, union, arbitrary eval, or network side effects.
 */

import type { StructuredError } from "../../types.ts";

export interface JsonPathResult {
	values: unknown[];
	errors: JsonPathError[];
}

export interface JsonPathError {
	path: string;
	code: string;
	message: string;
}

export interface JsonPathMatchInfo {
	path: string;
	matched: number;
	missing: boolean;
}

const PATH_TOKEN_RE = /^(?:\.(?<prop>[A-Za-z_$][A-Za-z0-9_$]*)|\[(?<idx>\d+)\]|\[(?<wild>\*)\])/u;

export function evaluateJsonPath(root: unknown, path: string): JsonPathResult {
	if (path === "$") return { values: [root], errors: [] };
	if (!path.startsWith("$")) {
		return {
			values: [],
			errors: [
				{
					path,
					code: "JSON_PATH_UNSUPPORTED",
					message: "JSONPath must start with '$'.",
				},
			],
		};
	}
	let remaining = path.slice(1);
	let current: unknown[] = [root];
	const errors: JsonPathError[] = [];

	while (remaining.length > 0) {
		const match = PATH_TOKEN_RE.exec(remaining);
		if (!match || !match.groups) {
			errors.push({
				path,
				code: "JSON_PATH_UNSUPPORTED",
				message: `Unsupported JSONPath token at "${remaining}".`,
			});
			return { values: [], errors };
		}
		const groups = match.groups;
		// oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime values may be undefined despite TS inference
		if (groups.prop !== undefined) {
			current = current.flatMap((item) =>
				isObjectRecord(item) && groups.prop in item ? [item[groups.prop]] : [],
			);
			// oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime values may be undefined despite TS inference
		} else if (groups.idx !== undefined) {
			const idx = Number(groups.idx);
			current = current.flatMap((item) =>
				Array.isArray(item) && idx < item.length ? [item[idx]] : [],
			);
			// oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime values may be undefined despite TS inference
		} else if (groups.wild !== undefined) {
			current = current.flatMap((item) => (Array.isArray(item) ? item : []));
		}
		remaining = remaining.slice(match[0].length);
	}

	return { values: current, errors };
}

export function evaluateJsonPaths(
	root: unknown,
	paths: string[],
): {
	values: unknown[];
	infos: JsonPathMatchInfo[];
	errors: JsonPathError[];
} {
	const allValues: unknown[] = [];
	const infos: JsonPathMatchInfo[] = [];
	const errors: JsonPathError[] = [];

	for (const path of paths) {
		const result = evaluateJsonPath(root, path);
		errors.push(...result.errors);
		infos.push({
			path,
			matched: result.values.length,
			missing: result.values.length === 0 && result.errors.length === 0,
		});
		allValues.push(...result.values);
	}

	return { values: allValues, infos, errors };
}

export function flattenJsonValues(values: unknown[]): string {
	return values.map(flattenOne).join("\n");
}

function flattenOne(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return value.map(flattenOne).join("\n");
	if (isObjectRecord(value)) return Object.values(value).map(flattenOne).join("\n");
	return JSON.stringify(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonSafe(text: string): {
	data: unknown;
	error?: StructuredError;
} {
	try {
		return { data: JSON.parse(text) };
	} catch (cause) {
		return {
			data: undefined,
			error: {
				code: "JSON_PARSE_FAILED",
				phase: "pattern_extract",
				message: cause instanceof Error ? cause.message : "Invalid JSON.",
				retryable: false,
			},
		};
	}
}

export function isSupportedJsonPath(path: string): boolean {
	if (path === "$") return true;
	if (!path.startsWith("$")) return false;
	let remaining = path.slice(1);
	while (remaining.length > 0) {
		const match = PATH_TOKEN_RE.exec(remaining);
		if (!match) return false;
		remaining = remaining.slice(match[0].length);
	}
	return true;
}
