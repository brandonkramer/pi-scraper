/**
 * @fileoverview scrape signals module.
 */
import type { FetchUrlResult } from "../http/client.ts";
import type { FastPageExtraction } from "../parse/page/fast.ts";
import type { ReadableExtraction } from "../parse/page/readable.ts";

export interface ScrapeSignals {
  visibleTextLength: number;
  htmlLength: number;
  textDensity: number;
  dataIslandTextLength: number;
  sparseDom: boolean;
  spaLikely: boolean;
  blockedLikely: boolean;
  shouldTryReadable: boolean;
  shouldTryFingerprint: boolean;
  shouldTryBrowser: boolean;
  reasons: string[];
}

const BLOCK_PATTERNS = [
  /captcha/iu,
  /cloudflare/iu,
  /access denied/iu,
  /temporarily blocked/iu,
  /unusual traffic/iu,
  /verify you are human/iu,
];

const SPA_PATTERNS = [
  /id=["'](?:root|app|__next)["']/iu,
  /__NEXT_DATA__/u,
  /window\.__INITIAL_STATE__/u,
  /data-reactroot/iu,
  /enable javascript/iu,
  /javascript is required/iu,
];

export function analyzeFastResult(response: FetchUrlResult, extraction: FastPageExtraction): ScrapeSignals {
  const visibleTextLength = extraction.text.length;
  const htmlLength = extraction.html.length || response.text?.length || 0;
  const dataIslandTextLength = extraction.dataIslands.reduce((sum, island) => sum + island.text.length, 0);
  const fullText = `${extraction.title ?? ""}\n${extraction.text}\n${response.text ?? ""}`;
  const statusBlocked = [401, 403, 407, 409, 418, 429, 503].includes(response.status);
  const blockedLikely = statusBlocked || BLOCK_PATTERNS.some((pattern) => pattern.test(fullText));
  const spaLikely = SPA_PATTERNS.some((pattern) => pattern.test(response.text ?? extraction.html));
  const textDensity = htmlLength > 0 ? visibleTextLength / htmlLength : 0;
  const sparseDom = visibleTextLength < 200 || textDensity < 0.03;
  const reasons = [
    blockedLikely ? "blocked_signal" : undefined,
    spaLikely ? "spa_marker" : undefined,
    sparseDom ? "sparse_dom" : undefined,
    dataIslandTextLength > visibleTextLength ? "rich_data_islands" : undefined,
  ].filter(Boolean) as string[];

  return {
    visibleTextLength,
    htmlLength,
    textDensity,
    dataIslandTextLength,
    sparseDom,
    spaLikely,
    blockedLikely,
    shouldTryReadable: !blockedLikely && (sparseDom || visibleTextLength < 800) && htmlLength > 0,
    shouldTryFingerprint: blockedLikely,
    shouldTryBrowser: (spaLikely && sparseDom && dataIslandTextLength < 200) || (blockedLikely && sparseDom),
    reasons,
  };
}

export function readableIsBetter(readable: ReadableExtraction, currentTextLength: number): boolean {
  if (!readable.ok || !readable.textContent) return false;
  return readable.textContent.length >= Math.max(250, currentTextLength * 1.15);
}

export function combineRecoveredText(extraction: FastPageExtraction): string {
  const parts = [
    extraction.text,
    ...extraction.dataIslands.map((island) => island.text),
    ...extraction.recovered.map((entry) => entry.text),
  ];
  return dedupeLines(parts.join("\n\n"));
}

function dedupeLines(text: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of text.split(/\n+/u).map((entry) => entry.trim()).filter(Boolean)) {
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  return lines.join("\n");
}
