import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
/**
 * @file Tool handler for web_extract strategy actions: cosine, css-extract, xpath-extract,
 *   regex-extract.
 */
import type { ScrapeMode } from "../types.ts";
import type { ToolUpdate } from "./infra/define.ts";
import { resolveExtractSource } from "./infra/extract-source.ts";
import { emitProgress } from "./infra/progress.ts";
import { inputErrorResult, toolResult } from "./infra/result.ts";

/** Params shared by all strategy actions. */
export interface StrategyParams {
	action?: string;
	url?: string;
	content?: string;
	responseId?: string;
	selectors?: Record<string, string>;
	query?: string;
	topN?: number;
	minScore?: number;
	attribute?: string;
	limit?: number;
	flags?: string;
	mode?: string;
	format?: string;
}

export interface StrategyToolOptions {
	modelAdapter?: unknown;
	scrapeDeps?: ScrapePipelineDeps;
}

export async function runCssExtract(
	params: StrategyParams,
	_options: StrategyToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.selectors || Object.keys(params.selectors).length === 0) {
		return inputErrorResult(
			"STRATEGY_INPUT_MISSING",
			"css-extract",
			"web_extract action=css-extract requires a selectors map.",
			"Provide a `selectors` object mapping field names to CSS selectors.",
		);
	}

	const content = await resolveContent(params, onUpdate, signal);
	if (typeof content !== "string") return content;

	const { extractCssStructured } = await import("../extract/strategy/css-extract.ts");
	const result = extractCssStructured({
		content,
		selectors: params.selectors,
		attribute: params.attribute,
		limit: params.limit,
	});

	const summary = `${result.matchedFields}/${result.totalSelectors} selectors matched`;
	const text = Object.entries(result.fields)
		.filter(([, v]) => v.length > 0)
		.map(([field, values]) => `${field}: ${values.join(", ")}`)
		.join("\n");

	return toolResult({
		text: text || summary,
		data: result,
		url: params.url,
		format: "json",
		summary,
	});
}

export async function runXpathExtract(
	params: StrategyParams,
	_options: StrategyToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.selectors || Object.keys(params.selectors).length === 0) {
		return inputErrorResult(
			"STRATEGY_INPUT_MISSING",
			"xpath-extract",
			"web_extract action=xpath-extract requires a selectors map.",
			"Provide a `selectors` object mapping field names to XPath selectors.",
		);
	}

	const content = await resolveContent(params, onUpdate, signal);
	if (typeof content !== "string") return content;

	const { extractXpathStructured } = await import("../extract/strategy/xpath-extract.ts");
	const result = extractXpathStructured({
		content,
		selectors: params.selectors,
		attribute: params.attribute,
		limit: params.limit,
	});

	const summary = `${result.matchedFields}/${result.totalSelectors} selectors matched`;
	const text = Object.entries(result.fields)
		.filter(([, v]) => v.length > 0)
		.map(([field, values]) => `${field}: ${values.join(", ")}`)
		.join("\n");

	return toolResult({
		text: text || summary,
		data: result,
		url: params.url,
		format: "json",
		summary,
	});
}

export async function runRegexExtract(
	params: StrategyParams,
	_options: StrategyToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.selectors || Object.keys(params.selectors).length === 0) {
		return inputErrorResult(
			"STRATEGY_INPUT_MISSING",
			"regex-extract",
			"web_extract action=regex-extract requires a selectors map.",
			"Provide a `selectors` object mapping field names to regex patterns.",
		);
	}

	const content = await resolveContent(params, onUpdate, signal);
	if (typeof content !== "string") return content;

	const { extractRegexStructured } = await import("../extract/strategy/regex-extract.ts");
	const result = extractRegexStructured({
		content,
		selectors: params.selectors,
		flags: params.flags,
		limit: params.limit,
	});

	const summary = `${result.matchedFields}/${result.totalSelectors} patterns matched`;
	const text = Object.entries(result.fields)
		.filter(([, v]) => v.length > 0)
		.map(([field, values]) => `${field}: ${values.join(", ")}`)
		.join("\n");

	return toolResult({
		text: text || summary,
		data: result,
		url: params.url,
		format: "json",
		summary,
	});
}

export async function runCosine(
	params: StrategyParams,
	_options: StrategyToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.query) {
		return inputErrorResult(
			"STRATEGY_INPUT_MISSING",
			"cosine",
			"web_extract action=cosine requires a query.",
			"Provide a `query` string to score text blocks against.",
		);
	}

	const content = await resolveContent(params, onUpdate, signal);
	if (typeof content !== "string") return content;

	const { scoreTextByCosine } = await import("../extract/strategy/cosine.ts");
	const result = scoreTextByCosine(content, params.query, params.topN ?? 5, params.minScore ?? 0.0);

	const text =
		result.blocks.length > 0
			? result.blocks
					.map((b, i) => `[${i + 1}] score=${b.score.toFixed(3)}: ${b.text.slice(0, 120)}`)
					.join("\n\n")
			: "No blocks met the minimum score threshold.";

	const summary = `${result.blocks.length} relevant blocks (of ${result.totalBlocks}) for "${params.query}"`;

	return toolResult({
		text,
		data: result,
		url: params.url,
		format: "json",
		summary,
	});
}

// ─── Shared helpers ────────────────────────────────────────────────────────

async function resolveContent(
	params: StrategyParams,
	onUpdate?: ToolUpdate,
	signal?: AbortSignal,
): Promise<string | ReturnType<typeof toolResult>> {
	const resolved = await resolveExtractSource(
		{ content: params.content, url: params.url, responseId: params.responseId },
		"strategy-extract",
	);
	if ("details" in resolved) return resolved;

	if (resolved.primary === "content" || resolved.primary === "responseId") {
		return resolved.content;
	}

	if (params.url) {
		await emitProgress(onUpdate, {
			state: "loading",
			url: params.url,
			message: "fetching page for extraction",
		});
		const { scrapeUrl } = await import("../scrape/pipeline.ts");
		const result = await scrapeUrl(
			params.url,
			{ mode: (params.mode ?? "fast") as ScrapeMode },
			{},
			signal,
		);
		const text = result.data.text ?? result.data.html;
		if (text) return text;
		return toolResult({
			text: "Could not fetch content from URL.",
			data: undefined,
			error: {
				code: "CONTENT_FETCH_FAILED",
				phase: "strategy-extract",
				message: "Could not extract text content from the fetched page.",
				retryable: false,
				url: params.url,
			},
			url: params.url,
		});
	}
	return inputErrorResult(
		"STRATEGY_INPUT_MISSING",
		"strategy-extract",
		"web_extract requires content, url, or responseId.",
		"Provide content, url, or responseId for extraction.",
	);
}
