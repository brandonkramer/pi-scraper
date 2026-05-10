/**
 * @fileoverview crawl state module.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { openStorageDb, type StorageDb } from "../storage/db.ts";
import type { ResolveStorageOptions } from "../storage/paths.ts";
import { resolvePiStoragePaths } from "../storage/paths.ts";
import type { StructuredError } from "../types.ts";
import type { FrontierItem } from "./frontier.ts";

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

interface MetadataRow {
	crawl_id: string;
	seed_url: string;
	status: CrawlStatus;
	visited_count: number;
	frontier_count: number;
	succeeded_count: number;
	failed_count: number;
	current_depth: number | null;
	max_depth_visited: number | null;
	response_id: string | null;
	last_error_json: string | null;
	created_at: string;
	updated_at: string;
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
	const updatedAt = new Date().toISOString();
	const updated = {
		...state,
		updatedAt,
		metadata: normalizeCrawlMetadata({ ...state, updatedAt }),
	};
	const metadata = updated.metadata;
	const db = await openStorageDb(options);
	db.transaction(() => {
		db.prepare(UPSERT_METADATA).run(
			metadata.crawlId,
			metadata.seedUrl,
			metadata.status,
			metadata.visitedCount,
			metadata.frontierCount,
			metadata.succeededCount,
			metadata.failedCount,
			metadata.currentDepth ?? null,
			metadata.maxDepthVisited ?? null,
			metadata.responseId ?? null,
			metadata.lastError ? JSON.stringify(metadata.lastError) : null,
			metadata.createdAt,
			metadata.updatedAt,
		);
		replaceFrontier(db, metadata.crawlId, updated.frontier, updatedAt);
		replaceVisited(db, metadata.crawlId, updated.visited, updatedAt);
		replaceResults(db, metadata.crawlId, updated.results);
	});
	return path.join(
		resolvePiStoragePaths(options).root,
		`index.db#crawl/${safeCrawlId(state.crawlId)}`,
	);
}

export async function loadCrawlState(
	crawlId: string,
	options: ResolveStorageOptions = {},
): Promise<CrawlState> {
	const metadata = await loadCrawlMetadata(crawlId, options);
	const db = await openStorageDb(options);
	const frontier = db
		.prepare(SELECT_FRONTIER)
		.all(crawlId) as unknown as FrontierItem[];
	const visited = (
		db.prepare(SELECT_VISITED).all(crawlId) as Array<{ url: string }>
	).map((row) => row.url);
	const results = (
		db.prepare(SELECT_RESULTS).all(crawlId) as Array<{ url: string }>
	).map((row) => row.url);
	return {
		crawlId: metadata.crawlId,
		seedUrl: metadata.seedUrl,
		createdAt: metadata.createdAt,
		updatedAt: metadata.updatedAt,
		frontier,
		visited,
		results,
		metadata,
	};
}

export async function loadCrawlMetadata(
	crawlId: string,
	options: ResolveStorageOptions = {},
): Promise<CrawlMetadata> {
	const db = await openStorageDb(options);
	const row = db
		.prepare("SELECT * FROM crawl_metadata WHERE crawl_id = ?")
		.get(crawlId) as MetadataRow | undefined;
	if (!row) throw new Error(`Crawl state not found: ${crawlId}`);
	return metadataFromRow(row);
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

export async function listCrawlMetadata(
	options: ResolveStorageOptions & {
		seed?: string;
		status?: CrawlStatus;
		limit?: number;
	} = {},
): Promise<CrawlMetadata[]> {
	const db = await openStorageDb(options);
	const seedLike = options.seed ? `${options.seed}%` : "%";
	const status = options.status ?? "%";
	const rows = db
		.prepare(LIST_CRAWLS)
		.all(seedLike, status, options.limit ?? 20) as unknown as MetadataRow[];
	return rows.map(metadataFromRow);
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

function metadataFromRow(row: MetadataRow): CrawlMetadata {
	return {
		crawlId: row.crawl_id,
		seedUrl: row.seed_url,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		status: row.status,
		visitedCount: row.visited_count,
		frontierCount: row.frontier_count,
		succeededCount: row.succeeded_count,
		failedCount: row.failed_count,
		currentDepth: row.current_depth ?? undefined,
		maxDepthVisited: row.max_depth_visited ?? undefined,
		responseId: row.response_id ?? undefined,
		lastError: row.last_error_json
			? (JSON.parse(row.last_error_json) as CrawlMetadata["lastError"])
			: undefined,
	};
}

function replaceFrontier(
	db: StorageDb,
	crawlId: string,
	frontier: FrontierItem[],
	now: string,
): void {
	const wanted = new Map(frontier.map((item) => [item.url, item]));
	const existing = new Map(
		(
			db
				.prepare(
					"SELECT url, depth, parent_url AS parentUrl FROM crawl_frontier WHERE crawl_id = ?",
				)
				.all(crawlId) as unknown as Array<FrontierItem>
		).map((row) => [row.url, row]),
	);
	const upsert = db.prepare(
		"INSERT OR REPLACE INTO crawl_frontier (crawl_id, url, depth, parent_url, enqueued_at) VALUES (?, ?, ?, ?, ?)",
	);
	for (const item of wanted.values()) {
		const current = existing.get(item.url);
		if (
			!current ||
			current.depth !== item.depth ||
			current.parentUrl !== item.parentUrl
		) {
			upsert.run(crawlId, item.url, item.depth, item.parentUrl ?? null, now);
		}
	}
	deleteRemoved(db, "crawl_frontier", crawlId, wanted);
}

function replaceVisited(
	db: StorageDb,
	crawlId: string,
	visited: string[],
	now: string,
): void {
	const wanted = new Set(visited);
	const existing = new Set(
		(
			db
				.prepare("SELECT url FROM crawl_visited WHERE crawl_id = ?")
				.all(crawlId) as Array<{ url: string }>
		).map((row) => row.url),
	);
	const insert = db.prepare(
		"INSERT OR REPLACE INTO crawl_visited (crawl_id, url, visited_at) VALUES (?, ?, ?)",
	);
	for (const url of wanted) {
		if (!existing.has(url)) insert.run(crawlId, url, now);
	}
	deleteRemoved(db, "crawl_visited", crawlId, wanted);
}

function replaceResults(
	db: StorageDb,
	crawlId: string,
	results: string[],
): void {
	const wanted = new Set(results);
	const existing = new Map(
		(
			db
				.prepare("SELECT url, position FROM crawl_results WHERE crawl_id = ?")
				.all(crawlId) as Array<{ url: string; position: number }>
		).map((row) => [row.url, row.position]),
	);
	const upsert = db.prepare(
		"INSERT OR REPLACE INTO crawl_results (crawl_id, url, position) VALUES (?, ?, ?)",
	);
	results.forEach((url, index) => {
		if (existing.get(url) !== index) upsert.run(crawlId, url, index);
	});
	deleteRemoved(db, "crawl_results", crawlId, wanted);
}

function deleteRemoved(
	db: StorageDb,
	table: string,
	crawlId: string,
	wanted: Set<string> | Map<string, unknown>,
): void {
	const rows = db
		.prepare(`SELECT url FROM ${table} WHERE crawl_id = ?`)
		.all(crawlId) as Array<{ url: string }>;
	const remove = db.prepare(
		`DELETE FROM ${table} WHERE crawl_id = ? AND url = ?`,
	);
	for (const row of rows) {
		if (!wanted.has(row.url)) remove.run(crawlId, row.url);
	}
}

function safeCrawlId(crawlId: string): string {
	return crawlId.replace(/[^a-zA-Z0-9._-]/gu, "_");
}

const UPSERT_METADATA = `INSERT OR REPLACE INTO crawl_metadata
(crawl_id, seed_url, status, visited_count, frontier_count, succeeded_count, failed_count, current_depth, max_depth_visited, response_id, last_error_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SELECT_FRONTIER = `SELECT url, depth, parent_url AS parentUrl FROM crawl_frontier WHERE crawl_id = ? ORDER BY depth, enqueued_at`;
const SELECT_VISITED = `SELECT url FROM crawl_visited WHERE crawl_id = ? ORDER BY visited_at`;
const SELECT_RESULTS = `SELECT url FROM crawl_results WHERE crawl_id = ? ORDER BY position`;
const LIST_CRAWLS = `SELECT * FROM crawl_metadata WHERE seed_url LIKE ? AND status LIKE ? ORDER BY updated_at DESC LIMIT ?`;
