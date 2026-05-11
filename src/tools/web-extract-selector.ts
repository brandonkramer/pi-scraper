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
		return toolResult({
			text: result.extractResult.text || summary,
			data: result.extractResult,
			url: result.url,
			format: "json",
			summary,
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
	return "Selector did not match and no adaptive candidate met the threshold.";
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
	if (selectorResult.strategy === "adaptive") {
		return "The selector was repaired using a stored fingerprint. Consider updating the identifier with autoSave for future stability.";
	}
	if (selectorResult.directMatches > 0 && !selectorResult.saved) {
		return "Consider enabling autoSave to make this extraction robust against future layout changes.";
	}
}
