/** @file Selector and pattern manifest runners. */
import { cleanText } from "../../text.ts";
import type { VerticalExtractorContext } from "../capabilities.ts";
import { applyResultLimits, buildRequestUrl, type MatchValues } from "../expression.ts";
import type { VerticalManifest } from "../manifest-types.ts";
import { applyMatchOptions } from "../matcher.ts";

export async function runSelector(
	manifest: VerticalManifest,
	url: URL,
	match: MatchValues,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const request = manifest.request!;
	const values = applyMatchOptions(url, match, manifest.matchOptions) ?? match;
	const page = await context.fetchPage?.(buildRequestUrl(request, url, values), signal);
	if (!page) throw new Error("fetchPage not available for selector manifest");
	return applyResultLimits(
		buildSelectorResult(stringExtractMap(manifest.extract), page.text),
		manifest,
	);
}

export async function runPattern(
	manifest: VerticalManifest,
	url: URL,
	match: MatchValues,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const request = manifest.request!;
	const values = applyMatchOptions(url, match, manifest.matchOptions) ?? match;
	const text = await context.fetchText?.(buildRequestUrl(request, url, values), signal);
	if (text === undefined) throw new Error("fetchText not available for pattern manifest");
	const result: Record<string, unknown> = {};
	for (const [field, pattern] of Object.entries(stringExtractMap(manifest.extract))) {
		const regex = new RegExp(pattern, "gmu");
		const matches = Array.from(text.matchAll(regex)).map((m) => (m.length > 1 ? m[1] : m[0]));
		result[field] = matches.length > 1 ? matches : matches[0];
	}
	return result;
}

function stringExtractMap(extract: VerticalManifest["extract"]): Record<string, string> {
	return Object.fromEntries(
		Object.entries(extract ?? {}).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function buildSelectorResult(
	extract: Record<string, string>,
	html: string,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [field, selector] of Object.entries(extract)) {
		result[field] = extractSimpleSelector(html, selector);
	}
	return result;
}

function extractSimpleSelector(html: string, selector: string): string | undefined {
	const tag = selector.trim().replace(/^[#.]/u, "");
	if (!/^[A-Za-z][\w-]*$/u.test(tag)) return undefined;
	const regex = new RegExp(`<${escapeRegex(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeRegex(tag)}>`, "iu");
	const value = regex.exec(html)?.[1];
	return value ? cleanText(value.replaceAll(/<[^>]+>/gu, "")) : undefined;
}

function escapeRegex(value: string): string {
	return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
