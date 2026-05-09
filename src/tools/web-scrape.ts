/**
 * @fileoverview Pi tool adapter for single-URL scraping and page summaries.
 */
import { Type, type Static } from "@earendil-works/pi-ai";
import type { ModelAdapter } from "../extract/model.js";
import type { ScrapePipelineDeps, ScrapeResult } from "../scrape/pipeline.js";
import {
  formatAge,
  qualityFromCache,
  refreshUrlAction,
  storedTraceContext,
} from "./agentic-context.js";
import { defineWebTool, type WebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import {
  errorResult,
  missingModelResult,
  missingModelError,
  structuredToolError,
  toolErrorResult,
  toolResult,
} from "./result.js";
import {
  buildSessionNotice,
  buildSessionText,
  deleteSessionAndStorage,
  getOrCreateSession,
  saveSessionToStorage,
} from "../http/session.js";
import { urlProperty } from "./schemas.js";
import {
  scrapeInputSummary,
  scrapeInputToolResult,
} from "./scrape-input-result.js";
import { renderWebScrapeResult, renderWebToolCall } from "./web-renderers.js";

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

  // Session + browser options (Tasks 28–30)
  sessionId: Type.Optional(Type.Any()),
  saveSession: Type.Optional(Type.Any()),
  clearSession: Type.Optional(Type.Any()),
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
    renderResult: (result, { expanded }, theme) =>
      renderWebScrapeResult(result, expanded, theme),
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
  return [`(${params.mode ?? "auto"} → ${params.format ?? "markdown"})`];
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
  const session = params.sessionId
    ? await getOrCreateSession(params.sessionId)
    : undefined;
  if (session) {
    if ((params as any).browserProfile)
      session.defaultBrowserProfile = (params as any).browserProfile;
    if (params.proxy) session.defaultProxy = params.proxy;
    if (params.mode) session.defaultMode = params.mode;
    if ((params as any).headers)
      session.defaultHeaders = {
        ...session.defaultHeaders,
        ...(params as any).headers,
      };
  }
  const scrapeOptions = {
    ...config.scrapeDefaults,
    ...(session
      ? {
          mode: session.defaultMode,
          browserProfile: session.defaultBrowserProfile,
          proxy: session.defaultProxy,
          headers: session.defaultHeaders,
        }
      : {}),
    ...params,
    mode: params.mode ?? session?.defaultMode ?? config.scrapeMode,
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
  await applySessionLifecycle(params);
  const sessionNotice = buildSessionNotice(params);
  const sessionSuffix = buildSessionText(params);
  return toolResult({
    text: result.error
      ? `Scrape failed: ${result.error.message}`
      : `${summarizeReadResult(result)}\nresponseId: ${stored.responseId}${sessionSuffix}`,
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

async function summarizeScrape(
  params: Params,
  options: WebScrapeToolOptions,
  signal: AbortSignal,
) {
  if (!options.modelAdapter) {
    return missingModelResult(
      "summarize",
      params.url,
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
    const summary = scrapeInputSummary(
      "Summarized",
      result.input,
      " from fresh scrape input",
      " from cached scrape input",
    );
    await applySessionLifecycle(params);
    return scrapeInputToolResult({
      text: result.summary,
      data: result,
      input: result.input,
      fallbackUrl: params.url,
      summary,
      answerContext: `${summary} Refresh the source page before summarizing time-sensitive facts.`,
      formatFallback: "markdown",
    });
  } catch (error) {
    return toolErrorResult(error, "SUMMARIZE_FAILED", "summarize", params.url);
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
    ...storedTraceContext({
      responseId,
      source: {
        id: "page",
        title: result.data.title,
        uri: url,
        excerpt: String(
          result.data.markdown ?? result.data.text ?? result.data.title ?? "",
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

async function applySessionLifecycle(params: Params): Promise<void> {
  if (!params.sessionId) return;
  if (params.saveSession) {
    await saveSessionToStorage(params.sessionId);
  }
  if (params.clearSession) {
    await deleteSessionAndStorage(params.sessionId);
  }
}
