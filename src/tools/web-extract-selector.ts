import type { SelectorExtractionResult } from "../extract/selector/css.ts";
/**
 * @remarks
 *   Fetches HTML, parses with htmlparser2, runs the adaptive selector engine, and converts matched
 *   elements into structured extraction output.
 * @file Web_extract action="selector" handler.
 */
import {
	SelectorInputError,
	runSelectorExtraction,
	type SelectorRunParams,
} from "../extract/selector/runner.ts";
import type { ToolUpdate } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { inputErrorResult, toolResult } from "./infra/result.ts";
import type { WebExtractToolOptions } from "./web-extract.ts";

const DATA_PREVIEW_LIMIT = 10;

export interface SelectorParams {
	action?: string;
	selector?: string;
	selectorType?: string;
	attribute?: string;
	identifier?: string;
	adaptive?: boolean;
	autoSave?: boolean;
	threshold?: number;
	limit?: number;
	url?: string;
	content?: string;
	responseId?: string;
	mode?: string;
	format?: string;
}

export async function runSelectorExtractionTool(
	params: SelectorParams,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.selector) {
		return inputErrorResult(
			"SELECTOR_INPUT_MISSING",
			"selector_extract",
			"web_extract action=selector requires a selector parameter.",
			"Provide selector for selector extraction.",
		);
	}
	await emitProgress(onUpdate, {
		state: "processing",
		url: params.url,
		message: `selector ${params.selector}`,
	});
	try {
		const result = await runSelectorExtraction(
			params as SelectorRunParams,
			options.scrapeDeps,
			signal,
		);
		const summary = buildSummary(result.selectorResult, result.extractResult);
		const data = limitSelectorData(result.extractResult);
		// Use summary as the main display text when there are multiple matches,
		// Show extracted content for direct matches and small adaptive/healed sets;
		// use summary for large adaptive/healed sets to avoid blank-line overflow.
		const showSummary =
			result.selectorResult.strategy !== "direct" && result.selectorResult.adaptiveMatches > 5;
		const text = showSummary ? summary : result.extractResult.text || summary;
		return toolResult({
			text,
			data,
			url: result.url,
			format: "json",
			// Omit summary when it duplicates main text to avoid double-rendering
			summary: showSummary ? undefined : summary,
			assistantGuidance: buildGuidance(result.selectorResult),
		});
	} catch (error) {
		if (error instanceof SelectorInputError) {
			return toolResult({
				text: error.message,
				data: undefined,
				error: {
					code: error.code,
					phase: error.phase,
					message: error.message,
					retryable: error.retryable,
					url: error.url,
				},
			});
		}
		throw error;
	}
}

function buildSummary(
	selectorResult: {
		strategy: string;
		directMatches: number;
		adaptiveMatches: number;
		score?: number;
		saved: boolean;
	},
	_extractResult: SelectorExtractionResult,
): string {
	if (selectorResult.strategy === "direct") {
		return `Selector matched ${selectorResult.directMatches} element(s)${selectorResult.saved ? "; 🔒 fingerprint saved" : ""}.`;
	}
	if (selectorResult.strategy === "adaptive") {
		return `Selector did not match directly; adaptive fallback found ${selectorResult.adaptiveMatches} candidate(s) with score ${selectorResult.score?.toFixed(2) ?? "?"}.`;
	}
	if (selectorResult.strategy === "healed") {
		return `Selector did not match directly; text-anchor healing found ${selectorResult.adaptiveMatches} candidate(s) with score ${selectorResult.score?.toFixed(2) ?? "?"}.`;
	}
	return "Selector did not match and no adaptive or healed candidate met the threshold.";
}

function buildGuidance(selectorResult: {
	strategy: string;
	directMatches: number;
	adaptiveMatches: number;
	saved: boolean;
}): string | undefined {
	if (selectorResult.strategy === "none") {
		return "Try a broader selector, enable adaptive mode with a lower threshold, or use the browser mode if the content is JavaScript-rendered.";
	}
	if (selectorResult.strategy === "adaptive" || selectorResult.strategy === "healed") {
		return "The selector was repaired using a stored fingerprint or text-anchor heuristic. Consider updating the identifier with autoSave for future stability.";
	}
	if (selectorResult.directMatches > 0 && !selectorResult.saved) {
		return "Consider enabling autoSave to make this extraction robust against future layout changes.";
	}
}

/**
 * Limit matches in the data payload to a preview size so the Pi TUI tree renderer doesn't produce
 * hundreds of blank lines from large match sets.
 */
function limitSelectorData(
	result: SelectorExtractionResult,
): SelectorExtractionResult & { totalMatches?: number; matchesPreview?: boolean } {
	if (result.matches.length <= DATA_PREVIEW_LIMIT) return result;
	return {
		...result,
		matches: result.matches.slice(0, DATA_PREVIEW_LIMIT),
		totalMatches: result.matches.length,
		matchesPreview: true,
	};
}
