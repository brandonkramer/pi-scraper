/** @file Api-json manifest runner. */
import type { VerticalExtractorContext } from "../capabilities.ts";
import {
	applyResultLimits,
	buildExtractResult,
	fetchJsonRequest,
	type MatchValues,
} from "../expression.ts";
import { extractJsonPath } from "../manifest-json-path.ts";
import type { VerticalManifest } from "../manifest-types.ts";
import { applyMatchOptions } from "../matcher.ts";

export async function runApiJson(
	manifest: VerticalManifest,
	url: URL,
	match: MatchValues,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const values = applyMatchOptions(url, match, manifest.matchOptions) ?? match;
	const response = await fetchJsonRequest(manifest.request!, url, values, context, signal);
	throwIfConfigured(manifest, response);
	return buildJsonResult(manifest, response, values);
}

function throwIfConfigured(manifest: VerticalManifest, response: unknown): void {
	const config = manifest.throwIf;
	if (!config) return;
	const value = extractJsonPath(
		response,
		config.path.startsWith("$") ? config.path : `$.${config.path}`,
	);
	if (value === undefined || value === null || value === "") return;
	const message =
		typeof config.message === "string"
			? config.message
			: typeof value === "string"
				? value
				: JSON.stringify(value);
	throw new Error(message);
}

function buildJsonResult(
	manifest: VerticalManifest,
	response: unknown,
	values: MatchValues,
): Record<string, unknown> {
	const extract = manifest.extract ?? {};
	const result = applyResultLimits(
		buildExtractResult(extract as Record<string, string>, response, values, "json"),
		manifest,
	);
	if (!manifest.extractList) return result;
	const list = extractJsonPath(response, manifest.extractList.path);
	const items = Array.isArray(list) ? list : [];
	const rows = items.map((item) =>
		buildExtractResult(manifest.extractList?.fields ?? {}, item, values, "json", {
			omitUndefined: manifest.extractList?.omitUndefined ?? false,
		}),
	);
	const wrapper = buildExtractResult(manifest.extractListWrapper ?? {}, response, values, "json");
	return { ...wrapper, [manifest.extractList.as ?? "items"]: rows };
}
