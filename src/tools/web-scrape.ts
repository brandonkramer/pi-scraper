/** @file Pi tool adapter for single-URL scraping and page summaries. */
import { Type, type Static } from "typebox";

import type { ModelAdapter } from "../extract/adhoc/model.ts";
import { getOrCreateSession } from "../http/session.ts";
import { describeScrapeResult, formatAge } from "../scrape/describe.ts";
import { filterLines } from "../scrape/line-filter.ts";
import { formatLineMatchPreview } from "../scrape/line-preview.ts";
import { resolveScrapeOptions } from "../scrape/options.ts";
import type { ScrapePipelineDeps, ScrapeResult } from "../scrape/pipeline.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { qualityFromCache, refreshUrlAction, storedTraceContext } from "./infra/agentic-context.ts";
import { defineWebTool, type WebTool } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import {
	inputErrorResult,
	missingModelResult,
	toolErrorResult,
	toolResult,
} from "./infra/result.ts";
import { sessionOptionSchema, urlProperty } from "./infra/schemas.ts";
import { buildSummarizeToolResult } from "./infra/scrape-input-result.ts";
import { sessionLifecycle } from "./infra/session-lifecycle.ts";
import { renderWebScrapeResult } from "./renderers/scrape.ts";

const scrapeTasks = ["read", "summarize"] as const;

export const webScrapeSchema = Type.Object({
	task: Type.Optional(Type.Any()),
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.Any()),
	sentences: Type.Optional(Type.Any()),
	bullets: Type.Optional(Type.Any()),
	mode: Type.Optional(Type.Any()),
	format: Type.Optional(Type.Any()),
	include: Type.Optional(Type.Array(Type.Any())),
	exclude: Type.Optional(Type.Array(Type.Any())),
	onlyMainContent: Type.Optional(Type.Any()),
	timeoutSeconds: Type.Optional(Type.Any()),
	maxChars: Type.Optional(Type.Any()),
	proxy: Type.Optional(Type.Any()),
	respectRobots: Type.Optional(Type.Any()),
	refresh: Type.Optional(Type.Any()),
	followAlternates: Type.Optional(Type.Boolean()),
	followMetaRefresh: Type.Optional(Type.Boolean()),
	linesMatching: Type.Optional(Type.Array(Type.String())),
	contextLines: Type.Optional(Type.Number()),
	caseSensitive: Type.Optional(Type.Boolean()),

	...sessionOptionSchema,
	stealth: Type.Optional(Type.Any()),
	autoWait: Type.Optional(Type.Any()),
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
			if (task === "summarize") return await summarizeScrape(params, options, signal);
			return await readScrape(params, signal, onUpdate);
		},
		renderCall: (args, theme, _context) =>
			renderSimpleCall("web_scrape", renderScrapeCallParts(args), theme),
		renderResult: (result, { expanded }, theme) => renderWebScrapeResult(result, expanded, theme),
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
				? `${String(params.bullets)} bullets`
				: params.sentences
					? `${String(params.sentences)} sentences`
					: undefined,
		].filter(Boolean) as string[];
	}
	return [`(${String(params.mode ?? "auto")} → ${String(params.format ?? "markdown")})`];
}

async function readScrape(
	params: Params,
	signal: AbortSignal,
	onUpdate?: Parameters<WebTool<typeof webScrapeSchema>["execute"]>[3],
) {
	if (!params.url) {
		return inputErrorResult(
			"SCRAPE_URL_MISSING",
			"scrape",
			"web_scrape task=read requires url.",
			"Provide url for web_scrape task=read.",
		);
	}
	const { loadEffectiveConfig } = await import("../config.ts");
	const config = await loadEffectiveConfig();
	const session = params.sessionId ? await getOrCreateSession(params.sessionId) : undefined;
	if (session) {
		const extra = params as Record<string, unknown>;
		if (extra.browserProfile) session.defaultBrowserProfile = extra.browserProfile as string;
		if (params.proxy) session.defaultProxy = params.proxy;
		if (params.mode) session.defaultMode = params.mode;
		if (extra.headers)
			session.defaultHeaders = {
				...session.defaultHeaders,
				...(extra.headers as Record<string, string>),
			};
	}
	const scrapeOptions = resolveScrapeOptions(params, config, session);
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
	const { scrapeUrl } = await import("../scrape/pipeline.ts");
	let result = await scrapeUrl(params.url, scrapeOptions, {}, signal);
	const needles = params.linesMatching;
	if (needles && needles.length > 0 && !result.error) {
		const text = result.data.rawText ?? result.data.text ?? "";
		const matches = filterLines(text, needles, params.contextLines, params.caseSensitive);
		result = { ...result, data: { ...result.data, matches } };
	}
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
	const { storeResponse } = await import("../storage/responses/store.ts");
	const stored = await storeResponse(result);
	const matchPreview = !result.error
		? formatLineMatchPreview(result.data.matches, { maxChars: 4_000 })
		: undefined;
	const shaped = shapeScrapeResult(result, stored.responseId, matchPreview);
	const { notice: sessionNotice, suffix: sessionSuffix } = await sessionLifecycle(params);
	const description = describeScrapeResult(result);
	const scrapeText = matchPreview
		? `${description.split("\n", 1)[0]}\n${matchPreview}`
		: description;
	return toolResult({
		text: result.error
			? `Scrape failed: ${result.error.message}`
			: `${scrapeText}\nresponseId: ${stored.responseId}${sessionSuffix}`,
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
		diagnostics: sessionNotice ? { sessionNotice } : undefined,
		...shaped,
	});
}

async function summarizeScrape(params: Params, options: WebScrapeToolOptions, signal: AbortSignal) {
	if (!options.modelAdapter) {
		return missingModelResult(
			"summarize",
			params.url,
			"web_scrape task=summarize requires a model-backed adapter; use task=read for source text.",
		);
	}
	try {
		const { loadEffectiveConfig } = await import("../config.ts");
		const { summarizePage } = await import("../summarize.ts");
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
		await sessionLifecycle(params);
		return buildSummarizeToolResult(result, params.url);
	} catch (error) {
		return toolErrorResult(error, "SUMMARIZE_FAILED", "summarize", params.url);
	}
}

function shapeScrapeResult(result: ScrapeResult, responseId: string, matchPreview?: string) {
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
			: `${matchPreview ?? "Page content below."}\nresponseId ${responseId} for stored access.`,
		...storedTraceContext({
			responseId,
			source: {
				id: "page",
				title: result.data.title,
				uri: url,
				excerpt: (
					matchPreview ??
					result.data.markdown ??
					result.data.text ??
					result.data.title ??
					""
				).slice(0, 240),
				relevance: "Primary scraped page content.",
				retrievedAt: result.cache?.fetchedAt ?? new Date().toISOString(),
				sourceType: "docs",
			},
			extraActions: [refreshUrlAction(url)],
		}),
		qualitySignals: qualityFromCache(result.cache),
	};
}
