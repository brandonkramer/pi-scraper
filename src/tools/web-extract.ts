/** @file Pi tool adapter for vertical, pattern, ad hoc, and surface extraction. */
import { type Static, Type } from "typebox";

import type { ModelAdapter } from "../extract/adhoc/model.ts";
import type { PatternSectionRequest } from "../extract/pattern/index.ts";
import type { PatternExcerptRequest, PatternRegexRequest } from "../extract/pattern/types.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { renderEnvelopeResult } from "../tui/envelope.ts";
import { defineWebTool, type WebTool } from "./infra/define.ts";
import {
	modelProviderOptionSchema,
	scrapeOutputOptionSchema,
	urlProperty,
} from "./infra/schemas.ts";
import { runAdHocExtraction } from "./web-extract-adhoc.ts";
import { hasPatternRequest, runPatternInspection } from "./web-extract-pattern.ts";
import { runSelectorExtractionTool } from "./web-extract-selector.ts";
import { runSummarize } from "./web-extract-summarize.ts";
import { runApiSurfaceExtraction } from "./web-extract-surface.ts";
import {
	listDeterministicExtractors,
	renderVerticalResult,
	runDeterministicExtractor,
} from "./web-extract-vertical.ts";

const extractActions = [
	"list",
	"vertical",
	"pattern",
	"surface",
	"selector",
	"summarize",
	"adhoc",
] as const;

const extractActionSchema = Type.Union([
	Type.Literal("list"),
	Type.Literal("vertical"),
	Type.Literal("pattern"),
	Type.Literal("surface"),
	Type.Literal("selector"),
	Type.Literal("summarize"),
	Type.Literal("adhoc"),
]);

const extractSchemaPresetSchema = Type.Union(
	[
		Type.Literal("api-reference"),
		Type.Literal("changelog"),
		Type.Literal("faq"),
		Type.Literal("compatibility-table"),
	],
	{ description: "Predefined extraction schema." },
);

export const webExtractSchema = Type.Object({
	action: Type.Optional(extractActionSchema),
	extractor: Type.Optional(Type.String({ description: "Vertical extractor name." })),
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.String({ description: "Inline content (when no URL)." })),
	prompt: Type.Optional(Type.String({ description: "Adhoc extraction prompt." })),
	schema: Type.Optional(
		Type.Any({ description: "JSON schema or shape for structured extraction." }),
	),
	sentences: Type.Optional(Type.Number()),
	bullets: Type.Optional(Type.Number()),
	...modelProviderOptionSchema,
	...scrapeOutputOptionSchema,
	sourceFormat: Type.Optional(Type.String({ description: "Override source content format." })),
	include: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	extractSchema: Type.Optional(extractSchemaPresetSchema),
	length: Type.Optional(
		Type.Union([Type.Boolean(), Type.String()], {
			description: "truthy flag or string preset",
		}),
	),
	markers: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	contains: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	excerpts: Type.Optional(
		Type.Unsafe<PatternExcerptRequest[]>({
			type: "array",
			description: "{needle,before,after,maxOccurrences}",
		}),
	),
	regexes: Type.Optional(
		Type.Unsafe<PatternRegexRequest[]>({
			type: "array",
			description: "{name,pattern,flags,captureGroup,maxMatches,contextBefore,contextAfter}",
		}),
	),
	sections: Type.Optional(
		Type.Unsafe<PatternSectionRequest[]>({
			type: "array",
			description: "{name,start,end,includeStart,includeEnd,maxChars}",
		}),
	),
	jsonPaths: Type.Optional(Type.Unsafe<string[]>({})),
	extract: Type.Optional(
		Type.String({ description: "Specific extraction target, e.g. 'api-surface'." }),
	),
	// Selector extraction (Task 27)
	selector: Type.Optional(Type.String({ description: "CSS/XPath selector." })),
	selectorType: Type.Optional(Type.String({ description: "css or xpath." })),
	attribute: Type.Optional(Type.String({ description: "HTML attribute to extract." })),
	identifier: Type.Optional(Type.String({ description: "Named extraction identifier." })),
	adaptive: Type.Optional(Type.Boolean({ description: "Adaptive selector relocation." })),
	autoSave: Type.Optional(Type.Boolean({ description: "Auto-save results." })),
	threshold: Type.Optional(Type.Number({ description: "Confidence threshold." })),
	limit: Type.Optional(Type.Integer({ description: "Result limit." })),
	respectRobots: Type.Optional(Type.Boolean({ description: "Default: true." })),
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
			if (action === "vertical")
				return await runDeterministicExtractor(params, options, signal, onUpdate);
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
		renderResult: (result, { expanded }, theme) => {
			const text = result.content[0]?.text ?? "";
			if (text.startsWith("\u2514\u2500")) return renderVerticalResult(result, expanded, theme);
			return renderEnvelopeResult(result, expanded, theme);
		},
	});
}

export const webExtractTool = createWebExtractTool();

function inferExtractAction(params: Params): ExtractAction {
	if (params.action) return params.action;
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
