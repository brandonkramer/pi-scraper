import { Type, type Static } from "@mariozechner/pi-ai";
import { runBatchScrape } from "../batch/run.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webBatchSchema = Type.Object({
  urls: Type.Array(urlProperty("URL to scrape."), { minItems: 1 }),
  concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 32 })),
  ...scrapeOptionSchema,
});

type Params = Static<typeof webBatchSchema>;

export const webBatchTool = defineWebTool({
  name: "web_batch",
  label: "Web Batch",
  description: "Scrape many independent URLs with web_scrape semantics. Local-first; failures are returned per URL instead of failing the entire batch.",
  parameters: webBatchSchema,
  async execute(_toolCallId, params: Params, signal, onUpdate) {
    const result = await runBatchScrape(params.urls, {
      ...params,
      storeFullResults: true,
      onProgress: (progress) => void emitProgress(onUpdate, { ...progress, state: progress.state === "queued" ? "queued" : progress.state === "processing" ? "processing" : progress.state }),
    }, {}, signal);
    return toolResult({ text: result.summary, data: result.items, responseId: result.responseId, fullOutputPath: result.fullOutputPath, truncated: result.truncated, mode: params.mode ?? "auto", format: params.format ?? "markdown" });
  },
  renderCall: (args, theme) => renderSimpleCall("web_batch", [`${args.urls.length} urls`, `(${args.mode ?? "auto"})`], theme),
  renderResult: (result, { expanded }) => renderEnvelopeResult(result, expanded),
});
