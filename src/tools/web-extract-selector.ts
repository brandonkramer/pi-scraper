/**
 * @fileoverview web_extract action="selector" handler.
 *
 * @remarks
 * Fetches HTML, parses with htmlparser2, runs the adaptive selector engine,
 * and converts matched elements into structured extraction output.
 */
import { parseDocument } from "htmlparser2";
import {
	loadFingerprint,
	saveFingerprint,
} from "../storage/element-fingerprints.js";
import {
	runAdaptiveSelector,
	type AdaptiveSelectorOptions,
} from "../parse/adaptive-selector.js";
import {
	extractFromSelectorResult,
	type SelectorExtractionResult,
} from "../extract/selector.js";
import type { ScrapePipelineDeps } from "../scrape/pipeline.js";
import type { ToolUpdate } from "./define.js";
import { emitProgress } from "./progress.js";
import { toolResult } from "./result.js";
import type { WebExtractToolOptions } from "./web-extract.js";

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

export async function runSelectorExtraction(
	params: SelectorParams,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.selector) {
		return toolResult({
			text: "Provide selector for selector extraction.",
			data: undefined,
			error: {
				code: "SELECTOR_INPUT_MISSING",
				phase: "selector_extract",
				message: "web_extract action=selector requires a selector parameter.",
				retryable: false,
			},
		});
	}

	await emitProgress(onUpdate, {
		state: "processing",
		url: params.url,
		message: `selector ${params.selector}`,
	});

	// 1. Get HTML content
	let html: string;
	let sourceUrl: string;
	if (params.content) {
		html = params.content;
		sourceUrl = "provided content";
	} else if (params.url) {
		const scrapeResult = await scrapeForSelector(
			params.url,
			params.mode,
			options.scrapeDeps,
			signal,
		);
		if (!scrapeResult) {
			return toolResult({
				text: `Failed to fetch ${params.url} for selector extraction.`,
				data: undefined,
				error: {
					code: "SELECTOR_FETCH_FAILED",
					phase: "selector_extract",
					message: "Could not fetch target URL for selector extraction.",
					retryable: true,
					url: params.url,
				},
			});
		}
		html = scrapeResult;
		sourceUrl = params.url;
	} else {
		return toolResult({
			text: "Provide url or content for selector extraction.",
			data: undefined,
			error: {
				code: "SELECTOR_INPUT_MISSING",
				phase: "selector_extract",
				message: "web_extract action=selector requires url or content.",
				retryable: false,
			},
		});
	}

	if (signal?.aborted) {
		return toolResult({
			text: "Selector extraction cancelled.",
			data: undefined,
		});
	}

	// 2. Parse HTML
	const document = parseDocument(html, {
		lowerCaseAttributeNames: true,
		lowerCaseTags: true,
	});

	// 3. Build adaptive options
	const adaptiveOptions: AdaptiveSelectorOptions = {
		selector: params.selector,
		selectorType: normalizeSelectorType(params.selectorType),
		identifier: params.identifier ?? params.selector,
		adaptive: params.adaptive ?? false,
		autoSave: params.autoSave ?? false,
		threshold: normalizeThreshold(params.threshold),
		limit: params.limit ?? 10,
	};

	// 4. Run selector
	const selectorResult = await runAdaptiveSelector(
		document,
		adaptiveOptions,
		async (id) => {
			const stored = await loadFingerprint(id, normalizeScope(sourceUrl));
			if (!stored) return undefined;
			try {
				return JSON.parse(
					stored.fingerprintJson,
				) as import("../parse/element-fingerprint.js").ElementFingerprint;
			} catch {
				return undefined;
			}
		},
		async (id, fp) => {
			await saveFingerprint(
				id,
				normalizeScope(sourceUrl),
				params.selector!,
				adaptiveOptions.selectorType,
				sourceUrl,
				JSON.stringify(fp),
			);
		},
	);

	// 5. Extract output
	const extractResult = extractFromSelectorResult(selectorResult, {
		format: normalizeFormat(params.format),
		attribute: params.attribute,
	});

	// 6. Build result
	const summary = buildSummary(selectorResult, extractResult);
	return toolResult({
		text: extractResult.text || summary,
		data: extractResult,
		url: params.url,
		format: "json",
		summary,
		assistantGuidance: buildGuidance(selectorResult),
	});
}

async function scrapeForSelector(
	url: string,
	mode: string | undefined,
	scrapeDeps: ScrapePipelineDeps | undefined,
	signal: AbortSignal,
): Promise<string | undefined> {
	try {
		const { scrapeUrl } = await import("../scrape/pipeline.js");
		const result = await scrapeUrl(
			url,
			{
				mode: (mode as any) ?? "fast",
			},
			scrapeDeps ?? {},
			signal,
		);
		return result.data?.html ?? result.data?.text ?? undefined;
	} catch {
		return undefined;
	}
}

function normalizeSelectorType(
	value: string | undefined,
): "css" | "xpath" | "text" {
	if (value === "xpath" || value === "text") return value;
	return "css";
}

function normalizeThreshold(value: number | undefined): number {
	if (value === undefined || value === null) return 0.35;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function normalizeFormat(
	value: string | undefined,
): "text" | "html" | "markdown" | "attribute" {
	if (
		value === "text" ||
		value === "html" ||
		value === "markdown" ||
		value === "attribute"
	) {
		return value;
	}
	return "text";
}

function normalizeScope(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return "default";
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
	return undefined;
}
