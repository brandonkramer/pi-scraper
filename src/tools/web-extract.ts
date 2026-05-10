/**
 * @fileoverview Pi tool adapter for vertical, pattern, ad hoc, and surface extraction.
 */
import { type Static, Type } from "@earendil-works/pi-ai";
import type { ModelAdapter } from "../extract/model.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import { defineWebTool, type WebTool } from "./define.ts";
import { renderEnvelopeResult } from "../tui/envelope-card.ts";
import { renderSimpleCall } from "../tui/simple-call.ts";
import { urlProperty } from "./schemas.ts";
import { runApiSurfaceExtraction } from "./web-extract-surface.ts";
import { runSelectorExtractionTool } from "./web-extract-selector.ts";
import {
	listDeterministicExtractors,
	runDeterministicExtractor,
} from "./web-extract-vertical.ts";
import { hasPatternRequest, runPatternInspection } from "./web-extract-pattern.ts";
import { runAdHocExtraction } from "./web-extract-adhoc.ts";

const extractActions = [
	"list",
	"vertical",
	"adhoc",
	"pattern",
	"surface",
	"selector",
] as const;
export const webExtractSchema = Type.Object({
	action: Type.Optional(Type.Any()),
	extractor: Type.Optional(Type.Any()),
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.Any()),
	prompt: Type.Optional(Type.Any()),
	schema: Type.Optional(Type.Any()),
	sourceFormat: Type.Optional(Type.Any()),
	include: Type.Optional(Type.Array(Type.Any())),
	extractSchema: Type.Optional(Type.Any()),
	length: Type.Optional(Type.Any()),
	markers: Type.Optional(Type.Array(Type.Any())),
	contains: Type.Optional(Type.Array(Type.Any())),
	excerpts: Type.Optional(
		Type.Array(
			Type.Unsafe({
				properties: {
					needle: Type.Optional(Type.Any()),
					before: Type.Optional(Type.Any()),
					after: Type.Optional(Type.Any()),
					caseSensitive: Type.Optional(Type.Any()),
					maxOccurrences: Type.Optional(Type.Any()),
				},
			}),
		),
	),
	regexes: Type.Optional(
		Type.Array(
			Type.Unsafe({
				properties: {
					name: Type.Optional(Type.Any()),
					pattern: Type.Optional(Type.Any()),
					flags: Type.Optional(Type.Any()),
					capture: Type.Optional(Type.Any()),
					captureGroup: Type.Optional(Type.Any()),
					includeContains: Type.Optional(Type.Any()),
					maxMatches: Type.Optional(Type.Any()),
					dedupe: Type.Optional(Type.Any()),
					sort: Type.Optional(Type.Any()),
					contextBefore: Type.Optional(Type.Any()),
					contextAfter: Type.Optional(Type.Any()),
				},
			}),
		),
	),
	sections: Type.Optional(
		Type.Array(
			Type.Unsafe({
				properties: {
					name: Type.Optional(Type.Any()),
					start: Type.Optional(Type.Any()),
					end: Type.Optional(Type.Any()),
					includeStart: Type.Optional(Type.Any()),
					includeEnd: Type.Optional(Type.Any()),
					caseSensitive: Type.Optional(Type.Any()),
					maxChars: Type.Optional(Type.Any()),
				},
			}),
		),
	),
	jsonPaths: Type.Optional(Type.Array(Type.String())),
	mode: Type.Optional(Type.Any()),
	extract: Type.Optional(Type.Any()),
	// Selector extraction (Task 27)
	selector: Type.Optional(Type.Any()),
	selectorType: Type.Optional(Type.Any()),
	attribute: Type.Optional(Type.Any()),
	identifier: Type.Optional(Type.Any()),
	adaptive: Type.Optional(Type.Any()),
	autoSave: Type.Optional(Type.Any()),
	threshold: Type.Optional(Type.Any()),
	limit: Type.Optional(Type.Any()),
});

export type Params = Static<typeof webExtractSchema>;
type ExtractAction = (typeof extractActions)[number];

export interface WebExtractToolOptions {
	modelAdapter?: ModelAdapter;
	scrapeDeps?: ScrapePipelineDeps;
}

export function createWebExtractTool(
	options: WebExtractToolOptions = {},
): WebTool<typeof webExtractSchema> {
	return defineWebTool({
		name: "web_extract",
		label: "Extract",
		description: "Vertical regex JSON/schema",
		parameters: webExtractSchema,
		async execute(_toolCallId, params: Params, signal, onUpdate) {
			const action = inferExtractAction(params);
			if (action === "list") return listDeterministicExtractors();
			if (action === "vertical")
				return runDeterministicExtractor(params, signal, onUpdate);
			if (action === "pattern")
				return runPatternInspection(params, signal, onUpdate);
			if (action === "surface")
				return runApiSurfaceExtraction(params, options, signal, onUpdate);
			if (action === "selector")
				return runSelectorExtractionTool(params, options, signal, onUpdate);
			return runAdHocExtraction(params, { modelAdapter: options.modelAdapter }, signal);
		},
		renderCall: (args, theme) =>
			renderSimpleCall("web_extract", renderExtractCallParts(args), theme),
		renderResult: (result, { expanded }) =>
			renderEnvelopeResult(result, expanded),
	});
}

export const webExtractTool = createWebExtractTool();

function inferExtractAction(params: Params): ExtractAction {
	if (params.action) return params.action as ExtractAction;
	if (params.selector) return "selector";
	if (!params.url && !params.content && !params.extractor) return "list";
	if (params.extract === "api-surface") return "surface";
	if (params.extractor) return "vertical";
	if (hasPatternRequest(params)) return "pattern";
	return "adhoc";
}

function renderExtractCallParts(params: Params): string[] {
	const action = inferExtractAction(params);
	if (action === "list") return ["list"];
	if (action === "selector")
		return [
			"selector",
			params.selector,
			params.url ?? "provided content",
		].filter(Boolean) as string[];
	return [action, params.extractor, params.url ?? "provided content"].filter(
		Boolean,
	) as string[];
}


