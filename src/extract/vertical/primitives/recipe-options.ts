/** @file Small helpers for reading primitive options from recipe YAML. */
import type { VerticalExtractorContext } from "../capabilities.ts";
import type { VerticalManifest } from "../manifest/types.ts";

export function recipeOptions(context: VerticalExtractorContext): Record<string, unknown> {
	return asRecord(context.recipe) ?? {};
}

/** Options for code-extract manifests (or legacy recipe.code.docstrings blocks). */
export function codeExtractOptions(manifest: VerticalManifest): Record<string, unknown> {
	if (manifest.kind === "code-extract") {
		return Object.fromEntries(
			Object.entries({
				languages: manifest.languages,
				extensions: manifest.extensions,
				includePrivate: manifest.includePrivate,
				maxExamples: manifest.maxExamples,
				maxExports: manifest.maxExports,
			}).filter(([, value]) => value !== undefined),
		);
	}
	return asRecord(manifest.recipe) ?? {};
}

export function optionRecord(
	options: Record<string, unknown>,
	path: string,
): Record<string, unknown> | undefined {
	return asRecord(readPath(options, path));
}

export function optionBoolean(
	options: Record<string, unknown>,
	path: string,
	fallback: boolean,
): boolean {
	const value = readPath(options, path);
	return typeof value === "boolean" ? value : fallback;
}

export function optionNumber(
	options: Record<string, unknown>,
	path: string,
	fallback: number,
): number {
	const value = readPath(options, path);
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(0, Math.trunc(value));
}

export function optionString(
	options: Record<string, unknown>,
	path: string,
	fallback: string,
): string {
	const value = readPath(options, path);
	return typeof value === "string" && value ? value : fallback;
}

export function optionStringArray(options: Record<string, unknown>, path: string): string[] {
	const value = readPath(options, path);
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function readPath(value: unknown, path: string): unknown {
	let current = value;
	for (const part of path.split(".").filter(Boolean)) {
		const record = asRecord(current);
		if (!record) return undefined;
		current = record[part];
	}
	return current;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
