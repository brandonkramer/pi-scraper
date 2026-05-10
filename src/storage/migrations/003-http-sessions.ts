/**
 * @fileoverview Migration V3: adds http_sessions table.
 */
import type { StorageDb } from "../db/open.ts";

export function migrateHttpSessions(db: StorageDb): void {
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
