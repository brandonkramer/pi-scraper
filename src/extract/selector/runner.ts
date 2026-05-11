/** @file Selector extraction runner — domain logic without tool contract. */
import { parseDocument } from "htmlparser2";

import type { ElementFingerprint } from "../../parse/adaptive/fingerprint.ts";
import {
	runAdaptiveSelector,
	type AdaptiveSelectorOptions,
} from "../../parse/adaptive/selector.ts";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";
import { loadFingerprint, saveFingerprint } from "../../storage/fingerprints.ts";
import type { ScrapeMode } from "../../types.ts";
import { extractFromSelectorResult, type SelectorExtractionResult } from "../selector/css.ts";

export interface SelectorRunParams {
	selector: string;
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

export interface SelectorRunResult {
	selectorResult: {
		strategy: string;
		directMatches: number;
		adaptiveMatches: number;
		score?: number;
		saved: boolean;
	};
	extractResult: SelectorExtractionResult;
	url?: string;
}

export async function runSelectorExtraction(
	params: SelectorRunParams,
	scrapeDeps?: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<SelectorRunResult> {
	let html: string;
	let sourceUrl: string;
	if (params.content) {
		html = params.content;
		sourceUrl = "provided content";
	} else if (params.url) {
		const scrapeResult = await scrapeForSelector(params.url, params.mode, scrapeDeps, signal);
		if (!scrapeResult) {
			throw new SelectorInputError(
				"SELECTOR_FETCH_FAILED",
				"Could not fetch target URL for selector extraction.",
				{ retryable: true, url: params.url },
			);
		}
		html = scrapeResult;
		sourceUrl = params.url;
	} else {
		throw new SelectorInputError(
			"SELECTOR_INPUT_MISSING",
			"Selector extraction requires url or content.",
			{ retryable: false },
		);
	}
	const document = parseDocument(html, {
		lowerCaseAttributeNames: true,
		lowerCaseTags: true,
	});
	const adaptiveOptions: AdaptiveSelectorOptions = {
		selector: params.selector,
		selectorType: normalizeSelectorType(params.selectorType),
		identifier: params.identifier ?? params.selector,
		adaptive: params.adaptive ?? false,
		autoSave: params.autoSave ?? false,
		threshold: normalizeThreshold(params.threshold),
		limit: params.limit ?? 10,
	};
	const selectorResult = await runAdaptiveSelector(
		document,
		adaptiveOptions,
		async (id) => {
			const stored = await loadFingerprint(id, normalizeScope(sourceUrl));
			if (!stored) return;
			try {
				return JSON.parse(stored.fingerprintJson) as ElementFingerprint;
			} catch {
				/* ignore */
			}
		},
		async (id, fp) => {
			await saveFingerprint(
				id,
				normalizeScope(sourceUrl),
				params.selector,
				adaptiveOptions.selectorType,
				sourceUrl,
				JSON.stringify(fp),
			);
		},
	);
	const extractResult = extractFromSelectorResult(selectorResult, {
		format: normalizeFormat(params.format),
		attribute: params.attribute,
	});
	return {
		selectorResult,
		extractResult,
		url: params.url,
	};
}

export class SelectorInputError extends Error {
	code: string;
	phase = "selector_extract";
	retryable: boolean;
	url?: string;
	constructor(code: string, message: string, options: { retryable: boolean; url?: string }) {
		super(message);
		this.code = code;
		this.retryable = options.retryable;
		this.url = options.url;
	}
}

async function scrapeForSelector(
	url: string,
	mode: string | undefined,
	scrapeDeps: ScrapePipelineDeps | undefined,
	signal?: AbortSignal,
): Promise<string | undefined> {
	try {
		const { scrapeUrl } = await import("../../scrape/pipeline.ts");
		const result = await scrapeUrl(
			url,
			{
				mode: (mode as ScrapeMode | undefined) ?? "fast",
			},
			scrapeDeps ?? {},
			signal,
		);
		// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
		return result.data?.html ?? result.data?.text ?? undefined;
	} catch {
		/* ignore */
	}
}

function normalizeSelectorType(value: string | undefined): "css" | "xpath" | "text" {
	if (value === "xpath" || value === "text") return value;
	return "css";
}

function normalizeThreshold(value: number | undefined): number {
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime values may be undefined despite TS inference
	if (value === undefined || value === null) return 0.35;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function normalizeFormat(value: string | undefined): "text" | "html" | "markdown" | "attribute" {
	if (value === "text" || value === "html" || value === "markdown" || value === "attribute") {
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
