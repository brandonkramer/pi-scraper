import { Type, type Static } from "@mariozechner/pi-ai";
import { diffScrapeResult } from "../diff/snapshots.js";
import { scrapeUrl } from "../scrape/pipeline.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webDiffSchema = Type.Object({
  url: urlProperty("URL to re-scrape and compare against cached snapshot."),
  ...scrapeOptionSchema,
});

type Params = Static<typeof webDiffSchema>;

export const webDiffTool = defineWebTool({
  name: "web_diff",
  label: "Web Diff",
  description: "Re-scrape one URL with the shared pipeline, normalize content, compare to cached snapshot, and store the new snapshot under ~/.pi/snapshots/.",
  parameters: webDiffSchema,
  async execute(_toolCallId, params: Params, signal, onUpdate) {
    await emitProgress(onUpdate, { state: "loading", url: params.url, message: "diffing against snapshot" });
    const diff = await diffScrapeResult(await scrapeUrl(params.url, params, {}, signal));
    const summary = diff.diff
      ? `${diff.diff.changedCount} changed, ${diff.diff.addedCount} added, ${diff.diff.removedCount} removed, ${diff.diff.unchanged} unchanged`
      : "No previous snapshot; saved baseline.";
    return toolResult({ text: summary, data: diff, url: params.url, finalUrl: diff.current.finalUrl, format: "json", fullOutputPath: diff.snapshotPath });
  },
  renderCall: (args, theme) => renderSimpleCall("web_diff", [args.url], theme),
  renderResult: (result, { expanded }) => renderEnvelopeResult(result, expanded),
});
