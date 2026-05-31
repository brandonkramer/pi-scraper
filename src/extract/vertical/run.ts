/** @file Dispatch manifest extraction by kind. */
import type { VerticalExtractorContext } from "./capabilities.ts";
import { codeDocstringsExtractor } from "./code-docstrings.ts";
import { runApiJsonAggregate, runApiJsonChain } from "./http-projection.ts";
import { runApiJson } from "./kinds/api-json.ts";
import { runApiXml } from "./kinds/api-xml.ts";
import { runFieldRules } from "./kinds/field-rules.ts";
import { runHttpWorkflow } from "./kinds/http-workflow.ts";
import { runLegacyRecipe } from "./kinds/legacy-recipe.ts";
import { runPattern, runSelector } from "./kinds/page-fetch.ts";
import { codeExtractOptions } from "./manifest-options.ts";
import type { VerticalManifest } from "./manifest-types.ts";

type MatchValues = Record<string, string>;

export async function runManifestExtraction(
	manifest: VerticalManifest,
	url: URL,
	match: MatchValues,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	switch (manifest.kind) {
		case "api-json":
			return await runApiJson(manifest, url, match, context, signal);
		case "api-json-aggregate":
			return await runApiJsonAggregate(manifest, url, match, context, signal);
		case "api-json-chain":
			return await runApiJsonChain(manifest, url, match, context, signal);
		case "http-workflow":
			return await runHttpWorkflow(manifest, url, match, context, signal);
		case "api-xml":
			return await runApiXml(manifest, url, match, context, signal);
		case "selector":
			return await runSelector(manifest, url, match, context, signal);
		case "pattern":
			return await runPattern(manifest, url, match, context, signal);
		case "html-extract":
		case "text-extract":
			return await runFieldRules(manifest, url, match, context, signal);
		case "code-extract": {
			const primitiveMatch = codeDocstringsExtractor.match(url) ?? match;
			return await codeDocstringsExtractor.extract(
				url,
				primitiveMatch,
				{ ...context, manifest: codeExtractOptions(manifest) },
				signal,
			);
		}
		case "recipe":
			return await runLegacyRecipe(manifest, url, match, context, signal);
		case "builtin":
			throw new Error(
				`Builtin manifest ${manifest.name} must be handled by a TypeScript extractor`,
			);
		default:
			return unsupportedManifestKind(manifest.kind);
	}
}

function unsupportedManifestKind(_kind: never): never {
	throw new Error("Unsupported manifest kind");
}
