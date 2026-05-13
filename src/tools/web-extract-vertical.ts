/**
 * @file Web_extract action="vertical" and action="list" handlers — deterministic extractor
 *   capabilities and vertical extraction.
 */
import { loadEffectiveConfig } from "../config/settings.ts";
import type { VerticalExtractionResult } from "../extract/vertical/capabilities.ts";
import type { ToolUpdate } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { inputErrorResult, toolResult } from "./infra/result.ts";
import type { Params } from "./web-extract.ts";

export async function listDeterministicExtractors() {
	const { listExtractorCapabilities } = await import("../extract/vertical/registry.ts");
	const capabilities = listExtractorCapabilities();
	return toolResult({
		text: `${capabilities.length} extractor(s): ${capabilities.map((item) => item.name).join(", ")}`,
		data: capabilities,
		format: "json",
		summary: "Listed deterministic extractor capabilities.",
		assistantGuidance:
			"Use action=vertical for supported known sites, action=pattern for deterministic markers/regex/excerpts, and action=adhoc for model-backed schema extraction.",
	});
}

export async function runDeterministicExtractor(
	params: Params,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.extractor || !params.url) {
		return inputErrorResult(
			"EXTRACT_INPUT_MISSING",
			"vertical_extract",
			"web_extract action=vertical requires both extractor and url.",
			"Provide extractor and url for vertical extraction.",
		);
	}
	const extractor: string = params.extractor;
	const url: string = params.url;
	const config = await loadEffectiveConfig();
	await emitProgress(onUpdate, {
		state: "processing",
		url,
		message: `extractor ${extractor}`,
	});
	const { runVerticalExtractor } = await import("../extract/vertical/registry.ts");
	const result = await runVerticalExtractor(
		extractor,
		url,
		{
			requestOptions: {
				cacheTtlSeconds: config.scrapeDefaults.cacheTtlSeconds,
				maxAgeSeconds: config.scrapeDefaults.maxAgeSeconds,
				refresh: config.scrapeDefaults.refresh,
				respectRobots: params.respectRobots,
			},
			onProgress: onUpdate
				? (options) =>
						emitProgress(onUpdate, {
							state: options.state as "waiting" | "loading" | "processing" | "done" | "error",
							message: options.message,
							url: options.url,
						})
				: undefined,
		},
		signal,
	);
	const firstSourceUrl = result.sources?.[0]?.url;
	return toolResult({
		text: verticalExtractorText(extractor, result),
		data: result,
		url,
		format: "json",
		sources: result.sources,
		summary: result.error
			? `${extractor} failed · ${url}`
			: `${extractor} done${firstSourceUrl ? ` · source: ${firstSourceUrl}` : ` · ${url}`}`,
		error: result.error && {
			...result.error,
			phase: "vertical_extract",
			url,
		},
		assistantGuidance: verticalExtractorGuidance(result),
	});
}

function verticalExtractorText(
	extractor: string | undefined,
	result: VerticalExtractionResult,
): string {
	const name = extractor ?? result.extractor;
	const blocked = blockedSource(result.data);
	if (blocked) {
		return [
			`${name} returned URL metadata only (${blocked.reason ?? "structured endpoint unavailable"})`,
			attemptedText(blocked.attemptedEndpoints ?? result.sources?.map((source) => source.url)),
		]
			.filter(Boolean)
			.join("\n");
	}
	if (result.error) {
		return [
			`${name} failed (${result.error.code}): ${result.error.message}`,
			attemptedText(result.sources?.map((source) => source.url)),
		]
			.filter(Boolean)
			.join("\n");
	}
	return `${name} extracted JSON`;
}

function verticalExtractorGuidance(result: VerticalExtractionResult): string | undefined {
	const blocked = blockedSource(result.data);
	if (blocked?.reason) return blocked.reason;
	return result.error?.message;
}

function attemptedText(urls: string[] | undefined): string | undefined {
	const uniqueUrls = [...new Set(urls?.filter(Boolean) ?? [])];
	return uniqueUrls.length > 0 ? `attempted:\n  - ${uniqueUrls.join("\n  - ")}` : undefined;
}

function blockedSource(
	data: unknown,
): { blocked?: boolean; reason?: string; attemptedEndpoints?: string[] } | undefined {
	const source = (data as { source?: unknown } | undefined)?.source;
	if (!source || typeof source !== "object") return;
	const typed = source as {
		blocked?: boolean;
		reason?: string;
		attemptedEndpoints?: string[];
	};
	return typed.blocked ? typed : undefined;
}
