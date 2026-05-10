/**
 * @fileoverview web_extract action="adhoc" handler — model-backed schema extraction.
 */
import { loadEffectiveConfig } from "../config/settings.ts";
import {
	extractAdHoc,
	MissingExtractInputError,
} from "../extract/adhoc/index.ts";
import {
	missingModelResult,
	errorResult,
	adapterNotFoundError,
	adapterIncompatibleError,
} from "./infra/result.ts";
import {
	scrapeInputSummary,
	scrapeInputToolResult,
} from "./infra/scrape-input-result.ts";
import { toolErrorResult } from "./infra/result.ts";
import {
	resolveAdapterFromRegistry,
	resolveProviderPreference,
} from "./infra/model-adapter.ts";
import { modelRegistry } from "./infra/model-registry.ts";
import type { Params, WebExtractToolOptions } from "./web-extract.ts";
import type { ToolExecutionContext } from "./infra/define.ts";

export async function runAdHocExtraction(
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	context?: ToolExecutionContext,
) {
	const config = await loadEffectiveConfig();
	const preference = resolveProviderPreference({
		paramProvider: params.provider as string | undefined,
		flagProvider: context?.getFlag?.("web-model-provider"),
		envProvider: process.env.PI_WEB_MODEL_PROVIDER,
		configProvider: config.modelProvider,
		capability: "extract",
	});
	const adapter =
		options.modelAdapter ?? resolveAdapterFromRegistry(preference, "extract");
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
					adapterNotFoundError(
						"extract",
						preference,
						registered,
						params.url,
					),
					`Model adapter "${preference}" is not registered.`,
				);
			}
			return errorResult(
				adapterIncompatibleError(
					"extract",
					preference,
					params.url,
				),
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
		return scrapeInputToolResult({
			text: summarizeExtraction(result.data),
			data: result,
			input: result.input,
			fallbackUrl: params.url,
			summary,
			answerContext: `${summary} Refresh the source page before extraction when the requested facts are time-sensitive.`,
		});
	} catch (error) {
		return toolErrorResult(
			error,
			error instanceof MissingExtractInputError
				? "MISSING_INPUT"
				: "EXTRACT_FAILED",
			"extract",
			params.url,
		);
	}
}

function summarizeExtraction(data: unknown): string {
	if (typeof data === "string") return data.slice(0, 1200);
	return `Extracted structured data\n${JSON.stringify(data, null, 2).slice(0, 1200)}`;
}
