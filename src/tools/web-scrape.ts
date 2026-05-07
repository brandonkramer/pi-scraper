import { Type, type Static } from "@mariozechner/pi-ai";
import type { ModelAdapter } from "../extract/model.js";
import type { ScrapePipelineDeps, ScrapeResult } from "../scrape/pipeline.js";
import {
	formatAge,
	qualityFromCache,
	refreshUrlAction,
	retrieveResultAction,
	sourceNote,
	storedResultGuidance,
} from "./agentic-context.js";
import { defineWebTool, type WebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import {
	errorResult,
	missingModelError,
	structuredToolError,
	toolResult,
} from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";
import { renderWebScrapeResult, renderWebToolCall } from "./web-renderers.js";

const scrapeTasks = ["read", "summarize"] as const;

export const webScrapeSchema = Type.Object({
	task: Type.Optional(Type.Any()),
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.String()),
	sentences: Type.Optional(Type.Any()),
	bullets: Type.Optional(Type.Any()),
	...scrapeOptionSchema,
});

type Params = Static<typeof webScrapeSchema>;
type ScrapeTask = (typeof scrapeTasks)[number];

export interface WebScrapeToolOptions {
	modelAdapter?: ModelAdapter;
	scrapeDeps?: ScrapePipelineDeps;
}

export function createWebScrapeTool(
	options: WebScrapeToolOptions = {},
): WebTool<typeof webScrapeSchema> {
	return defineWebTool({
		name: "web_scrape",
		label: "Scrape",
		description: "Read URL",
		parameters: webScrapeSchema,
		async execute(_toolCallId, params: Params, signal, onUpdate) {
			const task = inferScrapeTask(params);
			if (task === "summarize") return summarizeScrape(params, options, signal);
			return readScrape(params, signal, onUpdate);
		},
		renderCall: (args, theme, context) =>
			renderWebToolCall(
				"web_scrape",
				renderScrapeCallParts(args),
				theme,
				context,
			),
		renderResult: (result, { expanded }) =>
			renderWebScrapeResult(result, expanded),
	});
}

export const webScrapeTool = createWebScrapeTool();

function inferScrapeTask(params: Params): ScrapeTask {
	if (params.task) return params.task as ScrapeTask;
	if (params.content && !params.url) return "summarize";
	return "read";
}

function renderScrapeCallParts(params: Params): string[] {
	const task = inferScrapeTask(params);
	if (task === "summarize") {
		return [
			"summarize",
			params.url ?? "provided content",
			params.bullets
				? `${params.bullets} bullets`
				: params.sentences
					? `${params.sentences} sentences`
					: undefined,
		].filter(Boolean) as string[];
	}
	return [
		params.url,
		`(${params.mode ?? "auto"} → ${params.format ?? "markdown"})`,
	].filter(Boolean) as string[];
}

async function readScrape(
	params: Params,
	signal: AbortSignal,
	onUpdate?: Parameters<WebTool<typeof webScrapeSchema>["execute"]>[3],
) {
	if (!params.url) {
		return toolResult({
			text: "Provide url for web_scrape task=read.",
			data: undefined,
			error: {
				code: "SCRAPE_URL_MISSING",
				phase: "scrape",
				message: "web_scrape task=read requires url.",
				retryable: false,
			},
		});
	}
	const { loadEffectiveConfig } = await import("../config/settings.js");
	const config = await loadEffectiveConfig();
	const scrapeOptions = {
		...config.scrapeDefaults,
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
	const { scrapeUrl } = await import("../scrape/pipeline.js");
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
	const { storeResult } = await import("../storage/results.js");
	const stored = await storeResult(result);
	const shaped = shapeScrapeResult(result, stored.responseId);
	return toolResult({
		text: result.error
			? `Scrape failed: ${result.error.message}`
			: `${summarizeReadResult(result)}\nresponseId: ${stored.responseId}`,
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
}

async function summarizeScrape(
	params: Params,
	options: WebScrapeToolOptions,
	signal: AbortSignal,
) {
	if (!options.modelAdapter) {
		return errorResult(
			missingModelError("summarize", params.url),
			"web_scrape task=summarize requires a model-backed adapter; use task=read for source text.",
		);
	}
	try {
		const { loadEffectiveConfig } = await import("../config/settings.js");
		const { summarizePage } = await import("../summarize/page.js");
		const config = await loadEffectiveConfig();
		const result = await summarizePage(
			{
				...config.scrapeDefaults,
				...params,
				mode: params.mode ?? config.scrapeMode,
				format: params.format ?? config.outputFormat,
			},
			options.modelAdapter,
			options.scrapeDeps ?? {},
			signal,
		);
		const scrape = result.input.scrape;
		const summary = `Summarized ${result.input.source}${scrape?.cache?.cached ? " from cached scrape input" : scrape ? " from fresh scrape input" : " input"}.`;
		return toolResult({
			text: result.summary,
			data: result,
			url: result.input.url ?? params.url,
			finalUrl: scrape?.finalUrl,
			status: scrape?.status,
			mode: scrape?.mode,
			format: scrape?.format ?? "markdown",
			timing: scrape?.timing,
			truncated: scrape?.truncated,
			contentType: scrape?.contentType,
			downloadedBytes: scrape?.downloadedBytes,
			cache: scrape?.cache,
			summary,
			answerContext: `${summary} Refresh the source page before summarizing time-sensitive facts.`,
			qualitySignals: qualityFromCache(scrape?.cache),
			assistantGuidance: storedResultGuidance(),
		});
	} catch (error) {
		return errorResult(
			structuredToolError(error, "SUMMARIZE_FAILED", "summarize", params.url),
		);
	}
}

function summarizeReadResult(result: ScrapeResult): string {
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

function shapeScrapeResult(result: ScrapeResult, responseId: string) {
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
			: `Scrape result for ${url}: status ${result.status ?? "unknown"}, mode ${result.mode ?? "auto"}, format ${result.format ?? "markdown"}, ${source}. responseId ${responseId} is a local trace handle if inline preview is insufficient.`,
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
