import { Type, type Static } from "@mariozechner/pi-ai";
import { runCrawl } from "../crawl/runner.js";
import { storeResult } from "../storage/results.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webCrawlSchema = Type.Object({
  url: urlProperty("Seed URL to crawl."),
  maxPages: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
  maxDepth: Type.Optional(Type.Number({ minimum: 0, maximum: 20 })),
  sameOrigin: Type.Optional(Type.Boolean()),
  seedSitemap: Type.Optional(Type.Boolean()),
  crawlId: Type.Optional(Type.String()),
  concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 32 })),
  perHostConcurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 16 })),
  ...scrapeOptionSchema,
});

type Params = Static<typeof webCrawlSchema>;

export const webCrawlTool = defineWebTool({
  name: "web_crawl",
  label: "Web Crawl",
  description: "Breadth-first local-first crawl using the shared scraper pipeline with robots, depth/page limits, resume state, and compact stored results.",
  parameters: webCrawlSchema,
  async execute(_toolCallId, params: Params, signal, onUpdate) {
    const crawl = await runCrawl(params.url, {
      ...params,
      onProgress: (progress) => void emitProgress(onUpdate, { ...progress, state: progress.state === "queued" ? "queued" : progress.state === "processing" ? "processing" : progress.state }),
    }, {}, signal);
    const metadata = await storeResult(crawl);
    const text = `Crawl ${crawl.crawlId}: ${crawl.pages.length} page(s), ${crawl.visited.length} visited. responseId: ${metadata.responseId}`;
    return toolResult({ text, data: { crawlId: crawl.crawlId, pages: crawl.pages, visited: crawl.visited, statePath: crawl.statePath }, url: params.url, responseId: metadata.responseId, fullOutputPath: metadata.fullOutputPath, truncated: true });
  },
  renderCall: (args, theme) => renderSimpleCall("web_crawl", [args.url, `max ${args.maxPages ?? 50}`], theme),
  renderResult: (result, { expanded }) => renderEnvelopeResult(result, expanded),
});
