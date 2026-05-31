/** @file Web_extract action="adhoc" handler — model-backed schema extraction. */
import { loadEffectiveConfig } from "../config.ts";
import { extractAdHoc, MissingExtractInputError } from "../extract/adhoc/index.ts";
import type { GroundedField } from "../extract/grounding.ts";
import type { ToolExecutionContext } from "./infra/define.ts";
import {
	resolveAdapterFromRegistry,
	resolveModelAdapterFromContext,
	resolveProviderPreference,
} from "./infra/model-adapter.ts";
import { modelRegistry } from "./infra/model-registry.ts";
import {
	missingModelResult,
	errorResult,
	adapterNotFoundError,
	adapterIncompatibleError,
	toolErrorResult,
} from "./infra/result.ts";
import { scrapeInputSummary, scrapeInputToolContext } from "./infra/scrape-input-result.ts";
import type { Params, WebExtractToolOptions } from "./web-extract.ts";

export async function runAdHocExtraction(
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
		capability: "extract",
	});
	const adapter =
		options.modelAdapter ??
		resolveModelAdapterFromContext(context) ??
		resolveAdapterFromRegistry(preference, "extract");
	if (!adapter) {
		if (preference === "off") {
			return missingModelResult(
				"extract",
				params.url,
				"web_extract action=adhoc is disabled (provider=off). Use action=list or action=vertical for deterministic extractors.",
			);
		}
		if (preference !== "auto" && preference !== "off") {
			const entry = modelRegistry.get(preference);
			if (!entry) {
				const registered = modelRegistry.list().map((e) => e.id);
				return errorResult(
					adapterNotFoundError("extract", preference, registered, params.url),
					`Model adapter "${preference}" is not registered.`,
				);
			}
			return errorResult(
				adapterIncompatibleError("extract", preference, params.url),
				`Model adapter "${preference}" does not support extract.`,
			);
		}
		return missingModelResult(
			"extract",
			params.url,
			"web_extract action=adhoc requires a model-backed adapter. Use action=list or action=vertical for deterministic extractors.",
		);
	}
	try {
		const { include, extractSchema, ...extractParams } = params;
		void include;
		void extractSchema;
		const result = await extractAdHoc(
			{
				...config.scrapeDefaults,
				...extractParams,
				mode: params.mode ?? config.scrapeMode,
				format: config.outputFormat,
			},
			adapter,
			options.scrapeDeps ?? {},
			signal,
		);
		const summary = scrapeInputSummary(
			"Extracted structured data from",
			result.input,
			" using fresh scrape input",
			" using cached scrape input",
		);
		return scrapeInputToolContext({
			text: summarizeExtraction(result.data, result.grounded),
			data: result,
			input: result.input,
			fallbackUrl: params.url,
			summary,
			answerContext:
				"Refresh the source page before extraction when the requested facts are time-sensitive.",
			modelUsage: result.usage,
		});
	} catch (error) {
		return toolErrorResult(
			error,
			error instanceof MissingExtractInputError ? "MISSING_INPUT" : "EXTRACT_FAILED",
			"extract",
			params.url,
		);
	}
}

function summarizeExtraction(data: unknown, grounded?: GroundedField[]): string {
	if (typeof data === "string") return data.slice(0, 1200);
	const base = `Extracted structured data\n${JSON.stringify(data, null, 2).slice(0, 1200)}`;
	if (!grounded || grounded.length === 0) return base;
	const verified = grounded.filter((g) => g.sourceSpan !== null).length;
	const total = grounded.length;
	return `${base}\n(${verified}/${total} fields source-grounded)`;
}
