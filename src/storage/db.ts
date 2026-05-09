/**
 * @fileoverview storage db module.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import path from "node:path";
import { migrateLegacyFiles } from "./migrate-from-files.js";
import { migrateElementFingerprints } from "./element-fingerprints.js";
import {
	ensureDir,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "./paths.js";

interface DbEntry {
	db: DatabaseSync;
	statements: Map<string, StatementSync>;
}

const handles = new Map<string, DbEntry>();

export interface StorageDb {
	db: DatabaseSync;
	prepare(sql: string): StatementSync;
	transaction<T>(work: () => T): T;
}

/**
 * Opens the local SQLite metadata index lazily for the selected scraper root.
 *
 * @remarks
 * The database is intentionally synchronous because SQLite metadata operations
 * are tiny and WAL mode keeps concurrent readers safe. Payload bytes stay in
 * content-addressed files so the index never becomes the large-output store.
 */
export async function openStorageDb(
	options: ResolveStorageOptions = {},
): Promise<StorageDb> {
	const paths = resolvePiStoragePaths(options);
	await ensureDir(paths.root);
	const dbPath = path.join(paths.root, "index.db");
	let entry = handles.get(dbPath);
	if (!entry) {
		const db = new DatabaseSync(dbPath);
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA synchronous = NORMAL");
		db.exec("PRAGMA foreign_keys = ON");
		runMigrations(db);
		entry = { db, statements: new Map() };
		handles.set(dbPath, entry);
		await migrateLegacyFiles(wrapEntry(entry), options);
	}
	return wrapEntry(entry);
}

export function closeStorageDbs(): void {
	for (const entry of handles.values()) entry.db.close();
	handles.clear();
}

function wrapEntry(entry: DbEntry): StorageDb {
	return {
		db: entry.db,
		prepare(sql: string) {
			let statement = entry.statements.get(sql);
			if (!statement) {
				statement = entry.db.prepare(sql);
				entry.statements.set(sql, statement);
			}
			return statement;
		},
		transaction<T>(work: () => T): T {
			entry.db.exec("BEGIN IMMEDIATE");
			try {
				const result = work();
				entry.db.exec("COMMIT");
				return result;
			} catch (error) {
				entry.db.exec("ROLLBACK");
				throw error;
			}
		},
	};
}

function migrateHttpSessions(db: StorageDb): void {
	db.db.exec(`
CREATE TABLE IF NOT EXISTS http_sessions (
	id TEXT PRIMARY KEY,
	created_at TEXT NOT NULL,
	last_used_at TEXT NOT NULL,
	cookies_json TEXT NOT NULL,
	default_headers_json TEXT,
	default_browser_profile TEXT,
	default_os_profile TEXT,
	default_proxy TEXT,
	default_mode TEXT
);
`);
}

function runMigrations(db: DatabaseSync): void {
	const current = db.prepare("PRAGMA user_version").get() as {
		user_version: number;
	};
	if (current.user_version < 1) {
		db.exec(SCHEMA_V1);
	}
	if (current.user_version < 2) {
		migrateElementFingerprints(wrapDb(db));
		db.exec("PRAGMA user_version = 2");
	}
	if (current.user_version < 3) {
		migrateHttpSessions(wrapDb(db));
		db.exec("PRAGMA user_version = 3");
	}
}

function wrapDb(db: DatabaseSync): StorageDb {
	const statements = new Map<string, StatementSync>();
	return {
		db,
		prepare(sql: string) {
			let st = statements.get(sql);
			if (!st) {
				st = db.prepare(sql);
				statements.set(sql, st);
			}
			return st;
		},
		transaction<T>(work: () => T): T {
			db.exec("BEGIN IMMEDIATE");
			try {
				const result = work();
				db.exec("COMMIT");
				return result;
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
	};
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS responses (
  response_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  url_normalized TEXT NOT NULL,
  final_url TEXT,
  content_hash TEXT NOT NULL,
  content_type TEXT,
  status INTEGER,
  mode TEXT,
  format TEXT,
  byte_length INTEGER,
  stored_at TEXT NOT NULL,
  expires_at TEXT,
  metadata_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_responses_url_storedat ON responses(url_normalized, stored_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_hash ON responses(content_hash);
CREATE INDEX IF NOT EXISTS idx_responses_expires ON responses(expires_at);

CREATE TABLE IF NOT EXISTS fetched_responses (
  url_normalized TEXT NOT NULL,
  final_url TEXT,
  status INTEGER NOT NULL,
  content_type TEXT,
  content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  headers_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  etag TEXT,
  last_modified TEXT,
  PRIMARY KEY (url_normalized, fetched_at)
);
CREATE INDEX IF NOT EXISTS idx_fetched_url_freshness ON fetched_responses(url_normalized, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetched_expires ON fetched_responses(expires_at);

CREATE TABLE IF NOT EXISTS crawl_metadata (
  crawl_id TEXT PRIMARY KEY,
  seed_url TEXT NOT NULL,
  status TEXT NOT NULL,
  visited_count INTEGER NOT NULL DEFAULT 0,
  frontier_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  current_depth INTEGER,
  max_depth_visited INTEGER,
  response_id TEXT REFERENCES responses(response_id) ON DELETE SET NULL,
  last_error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_frontier (
  crawl_id TEXT NOT NULL REFERENCES crawl_metadata(crawl_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  depth INTEGER NOT NULL,
  parent_url TEXT,
  enqueued_at TEXT NOT NULL,
  PRIMARY KEY (crawl_id, url)
);
CREATE INDEX IF NOT EXISTS idx_frontier_pop ON crawl_frontier(crawl_id, depth, enqueued_at);

CREATE TABLE IF NOT EXISTS crawl_visited (
  crawl_id TEXT NOT NULL REFERENCES crawl_metadata(crawl_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  response_id TEXT REFERENCES responses(response_id) ON DELETE SET NULL,
  visited_at TEXT NOT NULL,
  PRIMARY KEY (crawl_id, url)
);

CREATE TABLE IF NOT EXISTS crawl_results (
  crawl_id TEXT NOT NULL REFERENCES crawl_metadata(crawl_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (crawl_id, url)
);

CREATE TABLE IF NOT EXISTS snapshots (
  url TEXT NOT NULL,
  snapshot_name TEXT NOT NULL,
  response_id TEXT NOT NULL REFERENCES responses(response_id) ON DELETE CASCADE,
  taken_at TEXT NOT NULL,
  PRIMARY KEY (url, snapshot_name, taken_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_named ON snapshots(url, snapshot_name) WHERE snapshot_name <> '';
PRAGMA user_version = 1;
`;
