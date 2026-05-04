import { Type, type Static } from "@mariozechner/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { scrapeUrl } from "../scrape/pipeline.js";
import { storeResult } from "../storage/results.js";
import {
	formatAge,
	qualityFromCache,
	refreshUrlAction,
	retrieveResultAction,
	sourceNote,
	storedResultGuidance,
} from "./agentic-context.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderWebScrapeResult, renderWebToolCall } from "./web-renderers.js";
import { toolResult } from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webScrapeSchema = Type.Object({
	url: urlProperty("URL to scrape."),
	...scrapeOptionSchema,
});

type Params = Static<typeof webScrapeSchema>;

export const webScrapeTool = defineWebTool({
	name: "web_scrape",
	label: "Web Scrape",
	description:
		"Local-first single-URL scrape using fast/readable/fingerprint/browser/auto modes. Browser/fingerprint are optional and used only when requested or justified.",
	parameters: webScrapeSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const config = await loadEffectiveConfig();
		const scrapeOptions = {
			...params,
			mode: params.mode ?? config.scrapeMode,
			format: params.format ?? config.outputFormat,
		};
		await emitProgress(onUpdate, {
			state: "loading",
			url: params.url,
			message: `scraping ${scrapeOptions.mode}`,
			checklist: [
				{ id: "validated", label: "URL validated", state: "done" },
				{ id: "robots", label: "robots checked", state: "pending" },
				{ id: "fetch", label: "fetching page", state: "pending" },
				{ id: "parse", label: "parsing content", state: "pending" },
				{ id: "store", label: "storing result", state: "pending" },
			],
		});
		const result = await scrapeUrl(params.url, scrapeOptions, {}, signal);
		await emitProgress(onUpdate, {
			state: result.error ? "error" : "done",
			url: result.finalUrl ?? params.url,
			message: result.error?.message,
			checklist: [
				{ id: "validated", label: "URL validated", state: "done" },
				{ id: "robots", label: "robots checked", state: "done" },
				{
					id: "fetch",
					label: result.cache?.cached ? "cache hit" : "fetched page",
					state: result.error ? "failed" : "done",
				},
				{
					id: "parse",
					label: "parsed content",
					state: result.error ? "failed" : "done",
				},
				{ id: "store", label: "storing result", state: "pending" },
			],
		});
		const stored = await storeResult(result);
		const shaped = shapeScrapeResult(result, stored.responseId);
		return toolResult({
			text: result.error
				? `Scrape failed: ${result.error.message}`
				: `${summarizeScrape(result)}\nresponseId: ${stored.responseId}`,
			data: result.data,
			url: result.url,
			finalUrl: result.finalUrl,
			status: result.status,
			mode: result.mode,
			format: result.format,
			timing: result.timing,
			truncated: result.truncated,
			contentType: result.contentType,
			downloadedBytes: result.downloadedBytes,
			cache: result.cache,
			responseId: stored.responseId,
			fullOutputPath: stored.fullOutputPath,
			error: result.error,
			...shaped,
		});
	},
	renderCall: (args, theme, context) =>
		renderWebToolCall(
			"web_scrape",
			[args.url, `(${args.mode ?? "auto"} → ${args.format ?? "markdown"})`],
			theme,
			context,
		),
	renderResult: (result, { expanded }) =>
		renderWebScrapeResult(result, expanded),
});

function summarizeScrape(
	result: Awaited<ReturnType<typeof scrapeUrl>>,
): string {
	const text =
		result.data.markdown ??
		result.data.text ??
		result.data.title ??
		result.data.route;
	const source = result.cache?.cached
		? `cache hit · ${formatAge(result.cache.ageSeconds)} · ${result.cache.staleness ?? "fresh"}`
		: "fresh fetch";
	return `${result.status ?? "ok"} · ${result.mode ?? "auto"} · ${result.format ?? "markdown"} · ${source}\n${String(text).slice(0, 1200)}`;
}

function shapeScrapeResult(
	result: Awaited<ReturnType<typeof scrapeUrl>>,
	responseId: string,
) {
	const url = result.finalUrl ?? result.url ?? "about:blank";
	const source = result.cache?.cached
		? `from cache fetched ${formatAge(result.cache.ageSeconds)} with staleness ${result.cache.staleness ?? "fresh"}`
		: "from a fresh network fetch";
	const summary = result.error
		? `Scrape failed for ${url}: ${result.error.message}`
		: `Scraped ${url} ${source}.`;
	return {
		summary,
		answerContext: result.error
			? `The scrape failed during ${result.error.phase}: ${result.error.message}`
			: `Scrape result for ${url}: status ${result.status ?? "unknown"}, mode ${result.mode ?? "auto"}, format ${result.format ?? "markdown"}, ${source}. Use responseId ${responseId} to retrieve the full stored content if the inline preview is insufficient.`,
		sourceNotes: [
			sourceNote({
				id: "page",
				title: result.data.title,
				uri: url,
				excerpt: String(
					result.data.markdown ?? result.data.text ?? result.data.title ?? "",
				).slice(0, 240),
				relevance: "Primary scraped page content.",
				retrievedAt: result.cache?.fetchedAt ?? new Date().toISOString(),
				sourceType: "docs",
			}),
		],
		qualitySignals: qualityFromCache(result.cache),
		nextActions: [retrieveResultAction(responseId), refreshUrlAction(url)],
		assistantGuidance: storedResultGuidance(),
	};
}
