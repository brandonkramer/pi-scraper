/** @file Pi tool adapter for model-backed page summaries. */
import { type Static, Type } from "@earendil-works/pi-ai";

import { loadEffectiveConfig } from "../config/settings.ts";
import type { ModelAdapter } from "../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import { summarizePage } from "../summarize/page.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { renderEnvelopeResult } from "../tui/envelope.ts";
import { defineWebTool, type WebTool } from "./infra/define.ts";
import { resolveAdapterFromRegistry, resolveProviderPreference } from "./infra/model-adapter.ts";
import {
	modelRegistry,
	requestAdapterDiscovery,
	type ModelCapability,
} from "./infra/model-registry.ts";
import {
	errorResult,
	missingModelResult,
	adapterNotFoundError,
	adapterIncompatibleError,
	toolErrorResult,
} from "./infra/result.ts";
import { modelProviderOptionSchema, scrapeModeOptionSchema, urlProperty } from "./infra/schemas.ts";
import { buildSummarizeToolResult } from "./infra/scrape-input-result.ts";

export const webSummarizeSchema = Type.Object({
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.String()),
	sentences: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	bullets: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	...modelProviderOptionSchema,
	...scrapeModeOptionSchema,
});

type Params = Static<typeof webSummarizeSchema>;

export interface WebSummarizeToolOptions {
	modelAdapter?: ModelAdapter;
	scrapeDeps?: ScrapePipelineDeps;
}

/** Tracks which capabilities have already triggered a lazy discover this session. */
const lazyDiscoverRequested = new Set<ModelCapability>();

export function createWebSummarizeTool(
	options: WebSummarizeToolOptions = {},
): WebTool<typeof webSummarizeSchema> {
	return defineWebTool({
		name: "web_summarize",
		label: "Sum",
		description: "Summarize URL no multi-source",
		parameters: webSummarizeSchema,
		async execute(_toolCallId, params: Params, signal, _onUpdate, context) {
			const config = await loadEffectiveConfig();
			const preference = resolveProviderPreference({
				paramProvider: params.provider,
				flagProvider: context?.getFlag?.("web-model-provider"),
				envProvider: process.env.PI_WEB_MODEL_PROVIDER,
				configProvider: config.modelProvider,
				capability: "summarize",
			});
			let adapter = options.modelAdapter ?? resolveAdapterFromRegistry(preference, "summarize");
			if (!adapter && !lazyDiscoverRequested.has("summarize")) {
				requestAdapterDiscovery(undefined, { capabilities: ["summarize"] });
				lazyDiscoverRequested.add("summarize");
				adapter = options.modelAdapter ?? resolveAdapterFromRegistry(preference, "summarize");
			}
			if (!adapter) {
				if (preference === "off") {
					return missingModelResult(
						"summarize",
						params.url,
						"web_summarize is disabled (provider=off). Use web_scrape to read source text locally.",
					);
				}
				if (preference !== "auto" && preference !== "off") {
					const entry = modelRegistry.get(preference);
					if (!entry) {
						const registered = modelRegistry.list().map((e) => e.id);
						return errorResult(
							adapterNotFoundError("summarize", preference, registered, params.url),
							`Model adapter "${preference}" is not registered.`,
						);
					}
					return errorResult(
						adapterIncompatibleError("summarize", preference, params.url),
						`Model adapter "${preference}" does not support summarize.`,
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
				return toolErrorResult(error, "SUMMARIZE_FAILED", "summarize", params.url);
			}
		},
		renderCall: (args, theme) =>
			renderSimpleCall(
				"web_summarize",
				[
					args.url ?? "provided content",
					args.bullets ? `${args.bullets} bullets` : `${args.sentences ?? 3} sentences`,
				],
				theme,
			),
		renderResult: (result, { expanded }, theme) => renderEnvelopeResult(result, expanded, theme),
	});
}

export const webSummarizeTool = createWebSummarizeTool();
