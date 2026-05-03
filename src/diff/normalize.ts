import type { ScrapeResult } from "../scrape/pipeline.js";

export interface NormalizedSnapshotContent {
  url: string;
  finalUrl?: string;
  title?: string;
  text: string;
}

export function normalizeScrapeForSnapshot(result: ScrapeResult): NormalizedSnapshotContent {
  return {
    url: result.url ?? "",
    finalUrl: result.finalUrl,
    title: result.data.title,
    text: normalizeSnapshotText(result.data.markdown ?? result.data.text ?? ""),
  };
}

export function normalizeSnapshotText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
