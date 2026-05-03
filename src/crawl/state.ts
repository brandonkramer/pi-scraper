import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, resolvePiStoragePaths, type ResolveStorageOptions } from "../storage/paths.js";
import type { FrontierItem } from "./frontier.js";

export interface CrawlState {
  crawlId: string;
  seedUrl: string;
  createdAt: string;
  updatedAt: string;
  frontier: FrontierItem[];
  visited: string[];
  results: string[];
}

export interface CrawlStateOptions extends ResolveStorageOptions {
  crawlId?: string;
}

export function createCrawlState(seedUrl: string, crawlId: string = randomUUID()): CrawlState {
  const now = new Date().toISOString();
  return { crawlId, seedUrl, createdAt: now, updatedAt: now, frontier: [], visited: [], results: [] };
}

export async function saveCrawlState(state: CrawlState, options: ResolveStorageOptions = {}): Promise<string> {
  const dir = await ensureDir(path.join(resolvePiStoragePaths(options).crawl, state.crawlId));
  const updated = { ...state, updatedAt: new Date().toISOString() };
  const filePath = path.join(dir, "state.json");
  await writeFile(filePath, JSON.stringify(updated, null, 2), { mode: 0o600 });
  return filePath;
}

export async function loadCrawlState(crawlId: string, options: ResolveStorageOptions = {}): Promise<CrawlState> {
  const filePath = path.join(resolvePiStoragePaths(options).crawl, crawlId, "state.json");
  return JSON.parse(await readFile(filePath, "utf8")) as CrawlState;
}
