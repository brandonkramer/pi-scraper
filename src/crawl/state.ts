import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	ensureDir,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "../storage/paths.js";
import type { StructuredError } from "../types.js";
import type { FrontierItem } from "./frontier.js";

export type CrawlStatus = "queued" | "running" | "paused" | "done" | "error";

export interface CrawlMetadata {
	crawlId: string;
	seedUrl: string;
	createdAt: string;
	updatedAt: string;
	status: CrawlStatus;
	visitedCount: number;
	frontierCount: number;
	succeededCount: number;
	failedCount: number;
	currentDepth?: number;
	maxDepthVisited?: number;
	lastError?: Pick<StructuredError, "code" | "message" | "phase" | "url">;
	responseId?: string;
}

export interface CrawlState {
	crawlId: string;
	seedUrl: string;
	createdAt: string;
	updatedAt: string;
	frontier: FrontierItem[];
	visited: string[];
	results: string[];
	metadata?: CrawlMetadata;
}

export interface CrawlStateOptions extends ResolveStorageOptions {
	crawlId?: string;
}

export function createCrawlState(
	seedUrl: string,
	crawlId: string = randomUUID(),
): CrawlState {
	const now = new Date().toISOString();
	return {
		crawlId,
		seedUrl,
		createdAt: now,
		updatedAt: now,
		frontier: [],
		visited: [],
		results: [],
		metadata: createCrawlMetadata(crawlId, seedUrl, now),
	};
}

export async function saveCrawlState(
	state: CrawlState,
	options: ResolveStorageOptions = {},
): Promise<string> {
	const dir = await ensureDir(crawlStateDir(state.crawlId, options));
	const updatedAt = new Date().toISOString();
	const updated = {
		...state,
		updatedAt,
		metadata: normalizeCrawlMetadata({ ...state, updatedAt }),
	};
	const filePath = path.join(dir, "state.json");
	await writeFile(filePath, JSON.stringify(updated, null, 2), { mode: 0o600 });
	return filePath;
}

export async function loadCrawlState(
	crawlId: string,
	options: ResolveStorageOptions = {},
): Promise<CrawlState> {
	const filePath = path.join(crawlStateDir(crawlId, options), "state.json");
	const parsed = JSON.parse(await readFile(filePath, "utf8")) as CrawlState;
	return { ...parsed, metadata: normalizeCrawlMetadata(parsed) };
}

export async function loadCrawlMetadata(
	crawlId: string,
	options: ResolveStorageOptions = {},
): Promise<CrawlMetadata> {
	return normalizeCrawlMetadata(await loadCrawlState(crawlId, options));
}

export async function updateCrawlMetadata(
	crawlId: string,
	patch: Partial<CrawlMetadata>,
	options: ResolveStorageOptions = {},
): Promise<CrawlMetadata> {
	const state = await loadCrawlState(crawlId, options);
	state.metadata = { ...normalizeCrawlMetadata(state), ...patch };
	await saveCrawlState(state, options);
	return loadCrawlMetadata(crawlId, options);
}

function normalizeCrawlMetadata(state: CrawlState): CrawlMetadata {
	return {
		...createCrawlMetadata(state.crawlId, state.seedUrl, state.createdAt),
		...state.metadata,
		crawlId: state.crawlId,
		seedUrl: state.seedUrl,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		visitedCount: state.visited.length,
		frontierCount: state.frontier.length,
		succeededCount: state.metadata?.succeededCount ?? state.results.length,
		failedCount: state.metadata?.failedCount ?? 0,
	};
}

function createCrawlMetadata(
	crawlId: string,
	seedUrl: string,
	now: string,
): CrawlMetadata {
	return {
		crawlId,
		seedUrl,
		createdAt: now,
		updatedAt: now,
		status: "queued",
		visitedCount: 0,
		frontierCount: 0,
		succeededCount: 0,
		failedCount: 0,
	};
}

function crawlStateDir(
	crawlId: string,
	options: ResolveStorageOptions,
): string {
	return path.join(resolvePiStoragePaths(options).crawl, safeCrawlId(crawlId));
}

function safeCrawlId(crawlId: string): string {
	return crawlId.replace(/[^a-zA-Z0-9._-]/gu, "_");
}
