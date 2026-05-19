/** @file Pi tool adapter for vertical, pattern, ad hoc, and surface extraction. */
import { type Static, Type } from "typebox";

import type { ModelAdapter } from "../extract/adhoc/model.ts";
import type { PatternSectionRequest } from "../extract/pattern/index.ts";
import type { PatternExcerptRequest, PatternRegexRequest } from "../extract/pattern/types.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { renderEnvelopeResult } from "../tui/envelope.ts";
import { defineWebTool, type WebTool } from "./infra/define.ts";
import { modelProviderOptionSchema, scrapeModeOptionSchema, urlProperty } from "./infra/schemas.ts";
import { runAdHocExtraction } from "./web-extract-adhoc.ts";
import { hasPatternRequest, runPatternInspection } from "./web-extract-pattern.ts";
import { runSelectorExtractionTool } from "./web-extract-selector.ts";
import { runSummarize } from "./web-extract-summarize.ts";
import { runApiSurfaceExtraction } from "./web-extract-surface.ts";
import { listDeterministicExtractors, runDeterministicExtractor } from "./web-extract-vertical.ts";

const extractActions = [
	"list",
	"vertical",
	"pattern",
	"surface",
	"selector",
	"summarize",
	"adhoc",
] as const;
export const webExtractSchema = Type.Object({
	action: Type.Optional(Type.Any()),
	extractor: Type.Optional(Type.Any()),
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.Any()),
	prompt: Type.Optional(Type.Any()),
	schema: Type.Optional(Type.Any()),
	sentences: Type.Optional(Type.Number()),
	bullets: Type.Optional(Type.Number()),
	...modelProviderOptionSchema,
	...scrapeModeOptionSchema,
	sourceFormat: Type.Optional(Type.Any()),
	include: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	extractSchema: Type.Optional(Type.Any()),
	length: Type.Optional(Type.Any()),
	markers: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	contains: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	excerpts: Type.Optional(
		Type.Unsafe<PatternExcerptRequest[]>({
			type: "array",
			description: "{needle,before,after,caseSensitive,maxOccurrences}",
		}),
	),
	regexes: Type.Optional(
		Type.Unsafe<PatternRegexRequest[]>({
			type: "array",
			description:
				"{name,pattern,flags,capture,captureGroup,includeContains,maxMatches,dedupe,sort,contextBefore,contextAfter}",
		}),
	),
	sections: Type.Optional(
		Type.Unsafe<PatternSectionRequest[]>({
			type: "array",
			description: "{name,start,end,includeStart,includeEnd,caseSensitive,maxChars}",
		}),
	),
	jsonPaths: Type.Optional(Type.Unsafe<string[]>({})),
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
	respectRobots: Type.Optional(Type.Any()),
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
		description: "Vertical/regex/JSON/schema/summarize extraction",
		parameters: webExtractSchema,
		async execute(_toolCallId, params: Params, signal, onUpdate, context) {
			const action = inferExtractAction(params);
			if (action === "list") return await listDeterministicExtractors();
			if (action === "vertical") return await runDeterministicExtractor(params, signal, onUpdate);
			if (action === "pattern")
				return await runPatternInspection(params, options, signal, onUpdate);
			if (action === "surface")
				return await runApiSurfaceExtraction(params, options, signal, onUpdate);
			if (action === "selector")
				return await runSelectorExtractionTool(params, options, signal, onUpdate);
			if (action === "summarize") return await runSummarize(params, options, signal, context);
			return await runAdHocExtraction(params, options, signal, context);
		},
		renderCall: (args, theme) =>
			renderSimpleCall("web_extract", renderExtractCallParts(args), theme),
		renderResult: (result, { expanded }, theme) => renderEnvelopeResult(result, expanded, theme),
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
	if (params.sentences !== undefined || params.bullets !== undefined) return "summarize";
	return "adhoc";
}

function renderExtractCallParts(params: Params): string[] {
	const action = inferExtractAction(params);
	if (action === "list") return ["list"];
	if (action === "selector")
		return ["selector", params.selector, params.url ?? "provided content"].filter(
			Boolean,
		) as string[];
	return [action, params.extractor, params.url ?? "provided content"].filter(Boolean) as string[];
}
