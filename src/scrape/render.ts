/**
 * @fileoverview scrape render module.
 */
import { DEFAULT_MAX_CHARS } from "../defaults.js";
import { toLlmText } from "../serialize/json.js";
import { htmlToMarkdown } from "../serialize/markdown.js";
import { normalizeWhitespace } from "../serialize/text.js";
import type {
	CommonScrapeOptions,
	OutputFormat,
	TimingInfo,
} from "../types.js";
import type { ScrapeData, ScrapeResult } from "./pipeline.js";

export function materializeFormat(
	result: ScrapeResult,
	format: OutputFormat,
	options: CommonScrapeOptions,
): ScrapeResult {
	if (result.data.route !== "html") return result;
	const html = result.data.html ?? "";
	const text = result.data.text ?? "";
	const markdown =
		format === "markdown"
			? htmlToMarkdown(html, { removeImages: options.removeImages })
			: result.data.markdown;
	const rendered = renderFormat(format, {
		title: result.data.title,
		description: result.data.description,
		text,
		markdown,
		html,
		metadata: result.data.metadata,
		json: result.data.json,
	});
	return { ...result, data: { ...result.data, ...rendered } };
}

export function renderFormat(
	format: OutputFormat,
	input: {
		title?: string;
		description?: string;
		text?: string;
		markdown?: string;
		html?: string;
		json?: unknown;
		metadata?: Record<string, unknown>;
	},
): Partial<ScrapeData> {
	if (format === "html") return { html: input.html };
	if (format === "json")
		return { json: input.json ?? input.metadata ?? { text: input.text } };
	if (format === "llm") return { text: toLlmText(input) };
	if (format === "text") return { text: normalizeWhitespace(input.text ?? "") };
	return { markdown: input.markdown ?? input.text ?? "", text: input.text };
}

export function finishResult(
	result: ScrapeResult,
	startedAt: Date,
): ScrapeResult {
	const endedAt = new Date();
	const timing: TimingInfo = {
		...result.timing,
		startedAt: startedAt.toISOString(),
		endedAt: endedAt.toISOString(),
		durationMs: endedAt.getTime() - startedAt.getTime(),
	};
	const maxChars = DEFAULT_MAX_CHARS;
	const text = result.data.markdown ?? result.data.text;
	if (text && text.length > maxChars) {
		const key = result.data.markdown ? "markdown" : "text";
		return {
			...result,
			timing,
			truncated: true,
			data: { ...result.data, [key]: text.slice(0, maxChars) },
		};
	}
	return { ...result, timing };
}
