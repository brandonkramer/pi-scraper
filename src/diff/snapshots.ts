import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { scrapeUrl, type ScrapePipelineDeps, type ScrapeResult } from "../scrape/pipeline.js";
import { ensureDir, resolvePiStoragePaths, type ResolveStorageOptions } from "../storage/paths.js";
import { normalizeUrl } from "../url/normalize.js";
import { compareSnapshotText, type TextDiffSummary } from "./compare.js";
import { normalizeScrapeForSnapshot, type NormalizedSnapshotContent } from "./normalize.js";

export interface PageSnapshot {
  url: string;
  finalUrl?: string;
  timestamp: string;
  textHash: string;
  content: NormalizedSnapshotContent;
}

export interface SnapshotDiffResult {
  previous?: PageSnapshot;
  current: PageSnapshot;
  diff?: TextDiffSummary;
  snapshotPath: string;
}

export async function saveSnapshot(result: ScrapeResult, options: ResolveStorageOptions = {}): Promise<{ snapshot: PageSnapshot; path: string }> {
  const snapshot = snapshotFromResult(result);
  const filePath = await snapshotPath(snapshot.url, options);
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  return { snapshot, path: filePath };
}

export async function loadSnapshot(url: string, options: ResolveStorageOptions = {}): Promise<PageSnapshot | undefined> {
  const filePath = await snapshotPath(url, options);
  try { return JSON.parse(await readFile(filePath, "utf8")) as PageSnapshot; } catch { return undefined; }
}

export async function diffScrapeResult(result: ScrapeResult, options: ResolveStorageOptions = {}): Promise<SnapshotDiffResult> {
  const previous = await loadSnapshot(result.url ?? "", options);
  const saved = await saveSnapshot(result, options);
  const diff = previous ? compareSnapshotText(previous.content.text, saved.snapshot.content.text) : undefined;
  return { previous, current: saved.snapshot, diff, snapshotPath: saved.path };
}

export async function diffUrl(url: string, options: ResolveStorageOptions = {}, deps: ScrapePipelineDeps = {}, signal?: AbortSignal): Promise<SnapshotDiffResult> {
  return diffScrapeResult(await scrapeUrl(url, {}, deps, signal), options);
}

function snapshotFromResult(result: ScrapeResult): PageSnapshot {
  const content = normalizeScrapeForSnapshot(result);
  return { url: content.url, finalUrl: content.finalUrl, timestamp: new Date().toISOString(), textHash: hash(content.text), content };
}

async function snapshotPath(url: string, options: ResolveStorageOptions): Promise<string> {
  const dir = await ensureDir(resolvePiStoragePaths(options).snapshots);
  return path.join(dir, `${hash(normalizeUrl(url))}.json`);
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
