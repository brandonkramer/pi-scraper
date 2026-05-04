import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { CrawlState } from "../crawl/state.js";
import type { ResponseStorageMetadata } from "../types.js";
import { normalizeUrl } from "../url/normalize.js";
import { writeBlob } from "./blobs.js";
import type { StorageDb } from "./db.js";
import { type ResolveStorageOptions, resolvePiStoragePaths } from "./paths.js";

interface LegacyEnvelope {
	metadata?: ResponseStorageMetadata;
	value?: unknown;
}

export interface MigrationSummary {
	responses: number;
	crawls: number;
}

/**
 * Migrates pre-SQLite result and crawl files into the SQLite index.
 *
 * @remarks
 * Legacy directories are renamed only after all rows and blobs are written.
 * Existing rows are skipped so the migrator is safe to run before every storage
 * lookup/write while an interrupted upgrade is recovering.
 */
export async function migrateLegacyFiles(
	db: StorageDb,
	options: ResolveStorageOptions = {},
): Promise<MigrationSummary> {
	const paths = resolvePiStoragePaths(options);
	let responses = 0;
	let crawls = 0;
	let responseMigrationOk = true;
	let crawlMigrationOk = true;

	if (await isDirectory(paths.results)) {
		try {
			responses = await migrateLegacyResults(db, paths.results, options);
		} catch (error) {
			responseMigrationOk = false;
			throw error;
		}
	}

	if (await isDirectory(paths.crawl)) {
		try {
			crawls = await migrateLegacyCrawls(db, paths.crawl);
		} catch (error) {
			crawlMigrationOk = false;
			throw error;
		}
	}

	if (responseMigrationOk && (await isDirectory(paths.results))) {
		await backupDirectory(paths.results, path.join(paths.root, "results.bak"));
	}
	if (crawlMigrationOk && (await isDirectory(paths.crawl))) {
		await backupDirectory(paths.crawl, path.join(paths.root, "crawl.bak"));
	}

	return { responses, crawls };
}

async function migrateLegacyResults(
	db: StorageDb,
	resultsDir: string,
	options: ResolveStorageOptions,
): Promise<number> {
	let migrated = 0;
	for (const entry of await readdir(resultsDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const filePath = path.join(resultsDir, entry.name);
		const envelope = JSON.parse(
			await readFile(filePath, "utf8"),
		) as LegacyEnvelope;
		const responseId =
			envelope.metadata?.responseId ?? path.basename(entry.name, ".json");
		if (hasResponse(db, responseId)) continue;
		const value = envelope.value ?? null;
		const contentType = envelope.metadata?.contentType ?? "application/json";
		const valueJson = JSON.stringify(value) ?? "null";
		const blob = await writeBlob(valueJson, contentType, options);
		const storedAt = envelope.metadata?.storedAt ?? new Date().toISOString();
		const metadata: ResponseStorageMetadata = {
			responseId,
			fullOutputPath: blob.blobPath,
			storedAt,
			byteLength: blob.byteLength,
			contentType,
		};
		const fields = responseFields(value, responseId);
		db.prepare(UPSERT_RESPONSE).run(
			responseId,
			fields.url,
			fields.urlNormalized,
			fields.finalUrl ?? null,
			blob.contentHash,
			contentType,
			fields.status ?? null,
			fields.mode ?? null,
			fields.format ?? null,
			blob.byteLength,
			storedAt,
			null,
			JSON.stringify(metadata),
		);
		migrated += 1;
	}
	return migrated;
}

async function migrateLegacyCrawls(
	db: StorageDb,
	crawlDir: string,
): Promise<number> {
	let migrated = 0;
	for (const entry of await readdir(crawlDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const statePath = path.join(crawlDir, entry.name, "state.json");
		if (!(await isFile(statePath))) continue;
		const state = JSON.parse(await readFile(statePath, "utf8")) as CrawlState;
		if (hasCrawl(db, state.crawlId)) continue;
		insertCrawlState(db, state);
		migrated += 1;
	}
	return migrated;
}

function insertCrawlState(db: StorageDb, state: CrawlState): void {
	const metadata = {
		crawlId: state.crawlId,
		seedUrl: state.seedUrl,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		status: state.metadata?.status ?? "queued",
		visitedCount: state.visited.length,
		frontierCount: state.frontier.length,
		succeededCount: state.metadata?.succeededCount ?? state.results.length,
		failedCount: state.metadata?.failedCount ?? 0,
		currentDepth: state.metadata?.currentDepth,
		maxDepthVisited: state.metadata?.maxDepthVisited,
		responseId: state.metadata?.responseId,
		lastError: state.metadata?.lastError,
	};
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
		const insertFrontier = db.prepare(
			"INSERT OR REPLACE INTO crawl_frontier (crawl_id, url, depth, parent_url, enqueued_at) VALUES (?, ?, ?, ?, ?)",
		);
		for (const item of state.frontier) {
			insertFrontier.run(
				state.crawlId,
				item.url,
				item.depth,
				item.parentUrl ?? null,
				state.updatedAt,
			);
		}
		const insertVisited = db.prepare(
			"INSERT OR REPLACE INTO crawl_visited (crawl_id, url, visited_at) VALUES (?, ?, ?)",
		);
		for (const url of state.visited) {
			insertVisited.run(state.crawlId, url, state.updatedAt);
		}
		const insertResult = db.prepare(
			"INSERT OR REPLACE INTO crawl_results (crawl_id, url, position) VALUES (?, ?, ?)",
		);
		state.results.forEach((url, index) =>
			insertResult.run(state.crawlId, url, index),
		);
	});
}

function responseFields(value: unknown, responseId: string) {
	const source =
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	const url =
		stringField(source.url) ??
		stringField(source.finalUrl) ??
		`urn:response:${responseId}`;
	return {
		url,
		urlNormalized: normalizeMaybe(url),
		finalUrl: stringField(source.finalUrl),
		status: numberField(source.status),
		mode: stringField(source.mode),
		format: stringField(source.format),
	};
}

function hasResponse(db: StorageDb, responseId: string): boolean {
	return Boolean(
		db.prepare("SELECT 1 FROM responses WHERE response_id = ?").get(responseId),
	);
}

function hasCrawl(db: StorageDb, crawlId: string): boolean {
	return Boolean(
		db.prepare("SELECT 1 FROM crawl_metadata WHERE crawl_id = ?").get(crawlId),
	);
}

async function backupDirectory(
	source: string,
	preferredBackup: string,
): Promise<void> {
	const target = (await exists(preferredBackup))
		? `${preferredBackup}.${Date.now()}-${randomUUID()}`
		: preferredBackup;
	await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	try {
		await rename(source, target);
	} catch {
		await cp(source, target, { recursive: true, errorOnExist: false });
	}
}

async function exists(filePath: string): Promise<boolean> {
	return stat(filePath).then(
		() => true,
		() => false,
	);
}

async function isDirectory(filePath: string): Promise<boolean> {
	return stat(filePath).then(
		(value) => value.isDirectory(),
		() => false,
	);
}

async function isFile(filePath: string): Promise<boolean> {
	return stat(filePath).then(
		(value) => value.isFile(),
		() => false,
	);
}

function normalizeMaybe(url: string): string {
	try {
		return normalizeUrl(url);
	} catch {
		return url;
	}
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

const UPSERT_RESPONSE = `INSERT OR REPLACE INTO responses
(response_id, url, url_normalized, final_url, content_hash, content_type, status, mode, format, byte_length, stored_at, expires_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_METADATA = `INSERT OR REPLACE INTO crawl_metadata
(crawl_id, seed_url, status, visited_count, frontier_count, succeeded_count, failed_count, current_depth, max_depth_visited, response_id, last_error_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
