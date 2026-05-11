import path from "node:path";
/** @file SQLite metadata index lifecycle — open, pool, close. */
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { migrateLegacyFiles } from "../migrations/legacy-files.ts";
// oxlint-disable-next-line import/no-cycle -- vertical extractors and storage modules share type contracts; cycle is resolved at call time
import { runMigrations } from "../migrations/run.ts";
import { ensureDir, type ResolveStorageOptions, resolvePiStoragePaths } from "../paths.ts";

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

export async function openStorageDb(options: ResolveStorageOptions = {}): Promise<StorageDb> {
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
