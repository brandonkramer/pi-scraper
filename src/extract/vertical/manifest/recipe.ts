/** @file Runtime bridge for complex YAML/JSONC vertical recipes. */
import type { VerticalExtractor, VerticalExtractorContext } from "../capabilities.ts";
import { codeDocstringsExtractor } from "../primitives/code-docstrings.ts";
import { runHttpJsonRecipe, supportsHttpJsonRecipe } from "./recipe-http.ts";
import { runRuleRecipe, supportsRuleRecipe } from "./recipe-rules.ts";
import { runWorkflowRecipe, supportsWorkflowRecipe } from "./recipe-workflow.ts";
import type { VerticalManifest } from "./types.ts";

const recipePrimitives = new Map<string, VerticalExtractor>([
	["code.docstrings", codeDocstringsExtractor],
]);

export async function runRecipeManifest(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	if (supportsHttpJsonRecipe(manifest)) {
		return await runHttpJsonRecipe(manifest, url, match, context, signal);
	}
	if (supportsRuleRecipe(manifest))
		return await runRuleRecipe(manifest, url, match, context, signal);
	if (supportsWorkflowRecipe(manifest))
		return await runWorkflowRecipe(manifest, url, match, context, signal);
	const primitiveName = manifest.recipe?.primitive;
	const primitive = selectRecipePrimitive(manifest);
	if (!primitive) throw new Error(`Unsupported recipe primitive: ${primitiveName ?? "<missing>"}`);
	const primitiveMatch = primitive.match(url) ?? match;
	const recipeContext = manifest.recipe ? { ...context, recipe: { ...manifest.recipe } } : context;
	return await primitive.extract(url, primitiveMatch, recipeContext, signal);
}

function selectRecipePrimitive(manifest: VerticalManifest): VerticalExtractor | undefined {
	const primitiveName = manifest.recipe?.primitive;
	return primitiveName ? recipePrimitives.get(primitiveName) : undefined;
}
