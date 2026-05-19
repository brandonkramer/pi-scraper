/** @file Web_extract action="summarize" handler — model-backed page summarization. */
import { loadEffectiveConfig } from "../config.ts";
import { summarizePage } from "../summarize.ts";
import type { ToolExecutionContext } from "./infra/define.ts";
import {
	resolveAdapterFromRegistry,
	resolveModelAdapterFromContext,
	resolveProviderPreference,
} from "./infra/model-adapter.ts";
import {
	modelRegistry,
	requestAdapterDiscovery,
	type ModelCapability,
} from "./infra/model-registry.ts";
import {
	adapterIncompatibleError,
	adapterNotFoundError,
	errorResult,
	missingModelResult,
	toolErrorResult,
} from "./infra/result.ts";
import { buildSummarizeToolResult } from "./infra/scrape-input-result.ts";
import type { Params, WebExtractToolOptions } from "./web-extract.ts";

/** Tracks which capabilities have already triggered a lazy discover this session. */
const lazyDiscoverRequested = new Set<ModelCapability>();

export async function runSummarize(
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	context?: ToolExecutionContext,
) {
	const config = await loadEffectiveConfig();
	const preference = resolveProviderPreference({
		paramProvider: params.provider,
		flagProvider: context?.getFlag?.("web-model-provider"),
		envProvider: process.env.PI_WEB_MODEL_PROVIDER,
		configProvider: config.modelProvider,
		capability: "summarize",
	});
	let adapter =
		options.modelAdapter ??
		resolveModelAdapterFromContext(context) ??
		resolveAdapterFromRegistry(preference, "summarize");
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
				"web_extract action=summarize is disabled (provider=off). Use web_scrape to read source text locally.",
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
			"web_extract action=summarize requires a model-backed adapter; use web_scrape to read source text locally.",
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
}
