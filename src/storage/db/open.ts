import path from "node:path";
/** @file SQLite metadata index lifecycle — open, pool, close. */

import { migrateLegacyFiles } from "../migrations/legacy-files.ts";
// oxlint-disable-next-line import/no-cycle -- vertical extractors and storage modules share type contracts; cycle is resolved at call time
import { runMigrations } from "../migrations/run.ts";
import { ensureDir, type ResolveStorageOptions, resolvePiStoragePaths } from "../paths.ts";

interface StatementSync {
	all(...anonymousParameters: unknown[]): unknown[];
	get(...anonymousParameters: unknown[]): unknown;
	run(...anonymousParameters: unknown[]): {
		changes: number | bigint;
		lastInsertRowid: number | bigint;
	};
}

interface DatabaseSync {
	close(): void;
	exec(sql: string): void;
	prepare(sql: string): StatementSync;
}

interface SqliteModule {
	DatabaseSync: new (location: string) => DatabaseSync;
}

let sqliteModule: Promise<SqliteModule> | undefined;

interface DbEntry {
	db: DatabaseSync;
	statements: Map<string, StatementSync>;
}

const handles = new Map<string, Promise<DbEntry>>();

export interface StorageDb {
	db: DatabaseSync;
	prepare(sql: string): StatementSync;
	transaction<T>(work: () => T): T;
}

export async function openStorageDb(options: ResolveStorageOptions = {}): Promise<StorageDb> {
	const paths = resolvePiStoragePaths(options);
	await ensureDir(paths.root);
	// oxlint-disable-next-line security/detect-non-literal-fs-filename -- dbPath is built from validated Pi storage root + static filename
	const dbPath = path.join(paths.root, "index.db");
	let promise = handles.get(dbPath);
	if (!promise) {
		promise = openDbEntry(dbPath, options);
		handles.set(dbPath, promise);
		promise.catch(() => handles.delete(dbPath));
	}
	const entry = await promise;
	return wrapEntry(entry);
}

async function openDbEntry(dbPath: string, options: ResolveStorageOptions): Promise<DbEntry> {
	const { DatabaseSync } = await loadSqliteModule();
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA foreign_keys = ON");
	runMigrations(db);
	const entry: DbEntry = { db, statements: new Map() };
	await migrateLegacyFiles(wrapEntry(entry), options);
	return entry;
}

function loadSqliteModule(): Promise<SqliteModule> {
	return (sqliteModule ??= import("node:sqlite"));
}

export async function closeStorageDbs(): Promise<void> {
	const closers: Promise<void>[] = [];
	for (const promise of handles.values()) {
		closers.push(
			promise
				.then((entry) => entry.db.close())
				.catch(() => {
					/* ignore close errors */
				}),
		);
	}
	handles.clear();
	await Promise.all(closers);
}

export function wrapDb(db: DatabaseSync): StorageDb {
	const entry: DbEntry = { db, statements: new Map() };
	return wrapEntry(entry);
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
