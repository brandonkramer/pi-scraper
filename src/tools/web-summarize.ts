/**
 * @fileoverview Pi tool adapter for model-backed page summaries.
 */
import { type Static, Type } from "@earendil-works/pi-ai";
import { loadEffectiveConfig } from "../config/settings.ts";
import type { ModelAdapter } from "../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import { summarizePage } from "../summarize/page.ts";
import { buildSummarizeToolResult } from "./infra/scrape-input-result.ts";
import { defineWebTool, type WebTool } from "./infra/define.ts";
import { modelRegistry } from "./infra/model-registry.ts";
import { renderEnvelopeResult } from "../tui/envelope.ts";
import { renderSimpleCall } from "../tui/call.ts";
import {
	errorResult,
	missingModelResult,
	missingModelError,
	adapterNotFoundError,
	adapterIncompatibleError,
	structuredToolError,
	toolErrorResult,
} from "./infra/result.ts";
import {
	resolveAdapterFromRegistry,
	resolveProviderPreference,
} from "./infra/model-adapter.ts";
import { scrapeModeOptionSchema, urlProperty } from "./infra/schemas.ts";

export const webSummarizeSchema = Type.Object({
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.String()),
	sentences: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	bullets: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	provider: Type.Optional(
		Type.Union([Type.Literal("auto"), Type.Literal("off"), Type.String()]),
	),
	...scrapeModeOptionSchema,
});

type Params = Static<typeof webSummarizeSchema>;

export interface WebSummarizeToolOptions {
	modelAdapter?: ModelAdapter;
	scrapeDeps?: ScrapePipelineDeps;
}

export function createWebSummarizeTool(
	options: WebSummarizeToolOptions = {},
): WebTool<typeof webSummarizeSchema> {
	return defineWebTool({
		name: "web_summarize",
		label: "Sum",
		description: "Summarize URL no multi-source",
		parameters: webSummarizeSchema,
		async execute(
			_toolCallId,
			params: Params,
			signal,
			_onUpdate,
			context,
		) {
			const config = await loadEffectiveConfig();
			const preference = resolveProviderPreference({
				paramProvider: params.provider,
				flagProvider: context?.getFlag?.("web-model-provider"),
				configProvider: config.modelProvider,
				capability: "summarize",
			});
			const adapter =
				options.modelAdapter ??
				resolveAdapterFromRegistry(preference, "summarize");
			if (!adapter) {
				if (preference === "off") {
					return missingModelResult(
						"summarize",
						params.url,
						"web_summarize is disabled (provider=off). Use web_scrape to read source text locally.",
					);
				}
				if (
					preference !== "auto" &&
					resolveAdapterFromRegistry(preference, "summarize") === undefined
				) {
					const registered = modelRegistry
						.list()
						.map((e) => e.id);
					return errorResult(
						adapterNotFoundError(
							"summarize",
							preference,
							registered,
							params.url,
						),
						`Model adapter "${preference}" is not registered.`,
					);
				}
				return missingModelResult(
					"summarize",
					params.url,
					"web_summarize requires a model-backed adapter; use web_scrape to read source text locally.",
				);
			}
			try {
				const result = await summarizePage(
					{
						...config.scrapeDefaults,
						...params,
						mode: params.mode ?? config.scrapeMode,
						format: config.outputFormat,
					},
					adapter,
					options.scrapeDeps ?? {},
					signal,
				);
				return buildSummarizeToolResult(result, params.url);
			} catch (error) {
				return toolErrorResult(
					error,
					"SUMMARIZE_FAILED",
					"summarize",
					params.url,
				);
			}
		},
		renderCall: (args, theme) =>
			renderSimpleCall(
				"web_summarize",
				[
					args.url ?? "provided content",
					args.bullets
						? `${args.bullets} bullets`
						: `${args.sentences ?? 3} sentences`,
				],
				theme,
			),
		renderResult: (result, { expanded }, theme) =>
			renderEnvelopeResult(result, expanded, theme),
	});
}

export const webSummarizeTool = createWebSummarizeTool();
