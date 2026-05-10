/**
 * @fileoverview web_extract action="pattern" handler — deterministic pattern inspection.
 */
import { loadEffectiveConfig } from "../config/settings.ts";
import {
	inspectPatterns,
	PatternInspectError,
	type PatternInspectOptions,
} from "../extract/pattern/index.ts";
import { storedResultGuidance } from "./infra/agentic-context.ts";
import type { ToolUpdate } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { toolResult, toolErrorResult } from "./infra/result.ts";
import type { Params, WebExtractToolOptions } from "./web-extract.ts";

export function hasPatternRequest(params: Params): boolean {
	return Boolean(
		params.sourceFormat ||
			params.include?.length ||
			params.extractSchema ||
			params.length ||
			params.markers?.length ||
			params.contains?.length ||
			params.excerpts?.length ||
			params.regexes?.length ||
			params.sections?.length,
	);
}

export async function runPatternInspection(
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	const config = await loadEffectiveConfig();
	try {
		if (params.url) {
			await emitProgress(onUpdate, {
				state: "connecting",
				url: params.url,
				message: "pattern inspection",
			});
		}
		const result = await inspectPatterns(
			{
				...config.scrapeDefaults,
				...params,
				mode: params.mode ?? config.scrapeMode,
			} as PatternInspectOptions,
			options.scrapeDeps ?? {},
			signal,
		);
		const foundMarkers =
			result.markers?.filter((item) => item.found).length ?? 0;
		const foundContains =
			result.contains?.filter((item) => item.found).length ?? 0;
		const matchCount =
			result.regexes?.reduce((total, item) => total + item.matches.length, 0) ??
			0;
		const sectionCount =
			result.sections?.filter((item) => item.found).length ?? 0;
		const summary = `Pattern inspection complete: ${result.source.length} chars, ${foundMarkers} marker(s), ${foundContains} contains hit(s), ${matchCount} regex match(es), ${sectionCount} section(s).`;
		return toolResult({
			text: summarizePatternInspection(result),
			data: result,
			url: result.source.url ?? params.url,
			finalUrl: result.source.finalUrl,
			status: result.source.status,
			mode: result.source.mode,
			format: result.source.sourceFormat,
			contentType: result.source.contentType,
			cache: result.source.cache,
			truncated: result.source.truncated,
			summary,
			answerContext:
				"This is deterministic text inspection. Use action=adhoc only when semantic/schema extraction needs model judgment.",
			assistantGuidance: storedResultGuidance(),
		});
	} catch (error) {
		return toolErrorResult(
			error,
			error instanceof PatternInspectError
				? error.structured.code
				: "PATTERN_EXTRACT_FAILED",
			"pattern_extract",
			params.url,
		);
	}
}

function summarizePatternInspection(data: unknown): string {
	return `Pattern inspection\n${JSON.stringify(data, null, 2).slice(0, 1600)}`;
}
