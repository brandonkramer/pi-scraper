/** @file Runtime bridge for legacy kind: recipe manifests. */
import type { VerticalExtractor, VerticalExtractorContext } from "../capabilities.ts";
import { codeDocstringsExtractor } from "../code-docstrings.ts";
import { runLegacyHttpJson, supportsLegacyHttpJson } from "../http-projection.ts";
import type { VerticalManifest } from "../manifest-types.ts";
import { runFieldRules, supportsFieldRules } from "./field-rules.ts";
import { runHttpWorkflow, supportsHttpWorkflow } from "./http-workflow.ts";

const recipePrimitives = new Map<string, VerticalExtractor>([
	["code.docstrings", codeDocstringsExtractor],
]);

export async function runLegacyRecipe(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	if (supportsLegacyHttpJson(manifest)) {
		return await runLegacyHttpJson(manifest, url, match, context, signal);
	}
	if (supportsFieldRules(manifest))
		return await runFieldRules(manifest, url, match, context, signal);
	if (supportsHttpWorkflow(manifest))
		return await runHttpWorkflow(manifest, url, match, context, signal);
	const primitiveName = manifest.recipe?.primitive;
	const primitive = selectRecipePrimitive(manifest);
	if (!primitive) throw new Error(`Unsupported recipe primitive: ${primitiveName ?? "<missing>"}`);
	const primitiveMatch = primitive.match(url) ?? match;
	const recipeContext = manifest.recipe
		? { ...context, manifest: { ...manifest.recipe } }
		: context;
	return await primitive.extract(url, primitiveMatch, recipeContext, signal);
}

function selectRecipePrimitive(manifest: VerticalManifest): VerticalExtractor | undefined {
	const primitiveName = manifest.recipe?.primitive;
	return primitiveName ? recipePrimitives.get(primitiveName) : undefined;
}
