/** @file Pi tool adapter for vertical, pattern, ad hoc, and surface extraction. */
import { type Static, Type } from "typebox";

import type { ModelAdapter } from "../extract/adhoc/model.ts";
import type { PatternSectionRequest } from "../extract/pattern/index.ts";
import type { PatternExcerptRequest, PatternRegexRequest } from "../extract/pattern/types.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import { toolCall } from "../tui/index.ts";
import { renderWebExtractSelectorResult } from "../tui/renderers/extract-selector.ts";
import { renderWebExtractResult } from "../tui/renderers/extract.ts";
import { renderVerticalResult } from "../tui/renderers/vertical.ts";
import type { PiToolShell, ToolContext } from "../types.ts";
import { defineWebTool, type WebTool } from "./infra/define.ts";
import {
	modelProviderOptionSchema,
	scrapeOutputOptionSchema,
	urlProperty,
} from "./infra/schemas.ts";
import { runAdHocExtraction } from "./web-extract-adhoc.ts";
import { hasPatternRequest, runPatternInspection } from "./web-extract-pattern.ts";
import { runSelectorExtractionTool } from "./web-extract-selector.ts";
import {
	runCssExtract,
	runXpathExtract,
	runRegexExtract,
	runCosine,
} from "./web-extract-strategies.ts";
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
	"css-extract",
	"xpath-extract",
	"regex-extract",
	"cosine",
] as const;

const extractActionSchema = Type.Unsafe<
	| "list"
	| "vertical"
	| "pattern"
	| "surface"
	| "selector"
	| "summarize"
	| "adhoc"
	| "css-extract"
	| "xpath-extract"
	| "regex-extract"
	| "cosine"
>({
	enum: [
		"list",
		"vertical",
		"pattern",
		"surface",
		"selector",
		"summarize",
		"adhoc",
		"css-extract",
		"xpath-extract",
		"regex-extract",
		"cosine",
	],
});

const extractSchemaPresetSchema = Type.Unsafe<
	"api-reference" | "changelog" | "faq" | "compatibility-table"
>({ enum: ["api-reference", "changelog", "faq", "compatibility-table"] });

export const webExtractSchema = Type.Object({
	action: Type.Optional(extractActionSchema),
	extractor: Type.Optional(
		Type.Unsafe<string>({
			description:
				"Vertical extractor name for action=vertical, e.g. huggingface_model or huggingface_dataset. Hugging Face accepts /owner/name and legacy /name URLs.",
		}),
	),
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.Unsafe<string>({})),
	prompt: Type.Optional(Type.Unsafe<string>({})),
	schema: Type.Optional(Type.Any()),
	sentences: Type.Optional(Type.Unsafe<number>({})),
	bullets: Type.Optional(Type.Unsafe<number>({})),
	...modelProviderOptionSchema,
	...scrapeOutputOptionSchema,
	sourceFormat: Type.Optional(Type.Unsafe<string>({})),
	include: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	extractSchema: Type.Optional(extractSchemaPresetSchema),
	length: Type.Optional(Type.Unsafe<boolean | string>({ type: ["boolean", "string"] })),
	markers: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	contains: Type.Optional(Type.Unsafe<any[]>({})), // oxlint-disable-line typescript/no-explicit-any
	excerpts: Type.Optional(
		Type.Unsafe<PatternExcerptRequest[]>({
			description: "{needle,before,after,occ}",
		}),
	),
	regexes: Type.Optional(
		Type.Unsafe<PatternRegexRequest[]>({
			description: "{name,pattern,flags,group,max,ctxBefore,ctxAfter}",
		}),
	),
	sections: Type.Optional(
		Type.Unsafe<PatternSectionRequest[]>({
			description: "{name,start,end,incStart,incEnd,max}",
		}),
	),
	jsonPaths: Type.Optional(Type.Unsafe<string[]>({})),
	extract: Type.Optional(Type.Unsafe<"api-surface">({ enum: ["api-surface"] })),
	// Selector extraction (Task 27)
	selector: Type.Optional(Type.Unsafe<string>({ description: "CSS/XPath" })),
	selectorType: Type.Optional(Type.Unsafe<string>({})),
	attribute: Type.Optional(Type.Unsafe<string>({})),
	identifier: Type.Optional(Type.Unsafe<string>({})),
	adaptive: Type.Optional(Type.Unsafe<boolean>({})),
	autoSave: Type.Optional(Type.Unsafe<boolean>({})),
	threshold: Type.Optional(Type.Unsafe<number>({})),
	limit: Type.Optional(Type.Unsafe<number>({})),
	respectRobots: Type.Optional(Type.Unsafe<boolean>({})),
	// Strategy extraction params (css-extract, xpath-extract, regex-extract, cosine)
	selectors: Type.Optional(
		Type.Unsafe<Record<string, string>>({
			description: "CSS/XPath/regex map",
		}),
	),
	query: Type.Optional(Type.Unsafe<string>({})),
	topN: Type.Optional(Type.Unsafe<number>({})),
	minScore: Type.Optional(Type.Unsafe<number>({})),
	flags: Type.Optional(Type.Unsafe<string>({})),
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
		description: "Vertical/regex/JSON/schema",
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
			if (action === "css-extract") return await runCssExtract(params, options, signal, onUpdate);
			if (action === "xpath-extract")
				return await runXpathExtract(params, options, signal, onUpdate);
			if (action === "regex-extract")
				return await runRegexExtract(params, options, signal, onUpdate);
			if (action === "cosine") return await runCosine(params, options, signal, onUpdate);
			return await runAdHocExtraction(params, options, signal, context);
		},
		renderCall: (args, theme) => toolCall("web_extract", renderExtractCallParts(args), theme),
		renderResult: (result, { expanded }, theme) => {
			const text = result.content[0]?.text ?? "";
			if (text.startsWith("\u2514\u2500")) return renderVerticalResult(result, expanded, theme);
			if (isSelectorResult(result)) return renderWebExtractSelectorResult(result, expanded, theme);
			return renderWebExtractResult(result, expanded, theme);
		},
	});
}

export const webExtractTool = createWebExtractTool();

function inferExtractAction(params: Params): ExtractAction {
	if (params.action) return params.action;
	if (params.selector) return "selector";
	if (params.selectors && typeof params.selectors === "object" && !Array.isArray(params.selectors))
		return "css-extract";
	if (!params.url && !params.content && !params.extractor) return "list";
	if (params.extract === "api-surface") return "surface";
	if (params.extractor) return "vertical";
	if (hasPatternRequest(params)) return "pattern";
	if (params.sentences !== undefined || params.bullets !== undefined) return "summarize";
	if (params.query) return "cosine";
	return "adhoc";
}

function renderExtractCallParts(params: Params): string[] {
	const action = inferExtractAction(params);
	if (action === "list") return ["list"];
	if (action === "selector")
		return ["selector", params.selector, params.url ?? "provided content"].filter(
			Boolean,
		) as string[];
	if (action === "css-extract")
		return ["css-extract", params.url ?? "inline content"].filter(Boolean);
	if (action === "xpath-extract")
		return ["xpath-extract", params.url ?? "inline content"].filter(Boolean);
	if (action === "regex-extract")
		return ["regex-extract", params.url ?? "inline content"].filter(Boolean);
	if (action === "cosine") return ["cosine", params.url ?? "inline content"].filter(Boolean);
	return [action, params.extractor, params.url ?? "provided content"].filter(Boolean) as string[];
}

function isSelectorResult(result: PiToolShell): boolean {
	const env = result.details as Partial<ToolContext<{ strategy?: string }>> | undefined;
	const s = env?.data?.strategy;
	return s === "direct" || s === "adaptive" || s === "healed" || s === "none";
}
