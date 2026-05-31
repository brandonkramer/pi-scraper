/** @file Api-xml manifest runner. */
import type { VerticalExtractorContext } from "../capabilities.ts";
import { buildExtractResult, buildRequestUrl, type MatchValues } from "../expression.ts";
import type { VerticalManifest } from "../manifest-types.ts";
import { applyMatchOptions } from "../matcher.ts";

export async function runApiXml(
	manifest: VerticalManifest,
	url: URL,
	match: MatchValues,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const values = applyMatchOptions(url, match, manifest.matchOptions) ?? match;
	const request = manifest.request!;
	const fetchUrl = buildRequestUrl(request, url, values);
	const text = await context.fetchText?.(fetchUrl, signal);
	if (text === undefined) throw new Error("fetchText not available for api-xml manifest");
	return buildExtractResult(stringExtractMap(manifest.extract), text, values, "xml");
}

function stringExtractMap(extract: VerticalManifest["extract"]): Record<string, string> {
	return Object.fromEntries(
		Object.entries(extract ?? {}).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}
