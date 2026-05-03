import { Type, type Static } from "@mariozechner/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { scrapeUrl } from "../scrape/pipeline.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
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
  description: "Local-first single-URL scrape using fast/readable/fingerprint/browser/auto modes. Browser/fingerprint are optional and used only when requested or justified.",
  parameters: webScrapeSchema,
  async execute(_toolCallId, params: Params, signal, onUpdate) {
    const config = await loadEffectiveConfig();
    const scrapeOptions = { ...params, mode: params.mode ?? config.scrapeMode, format: params.format ?? config.outputFormat };
    await emitProgress(onUpdate, { state: "loading", url: params.url, message: `scraping ${scrapeOptions.mode}` });
    const result = await scrapeUrl(params.url, scrapeOptions, {}, signal);
    await emitProgress(onUpdate, { state: result.error ? "error" : "done", url: result.finalUrl ?? params.url, message: result.error?.message });
    return toolResult({
      text: result.error ? `Scrape failed: ${result.error.message}` : summarizeScrape(result),
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
      error: result.error,
    });
  },
  renderCall: (args, theme) => renderSimpleCall("web_scrape", [args.url, `(${args.mode ?? "auto"} → ${args.format ?? "markdown"})`], theme),
  renderResult: (result, { expanded }) => renderEnvelopeResult(result, expanded),
});

function summarizeScrape(result: Awaited<ReturnType<typeof scrapeUrl>>): string {
  const text = result.data.markdown ?? result.data.text ?? result.data.title ?? result.data.route;
  return `${result.status ?? "ok"} · ${result.mode ?? "auto"} · ${result.format ?? "markdown"}\n${String(text).slice(0, 1200)}`;
}
