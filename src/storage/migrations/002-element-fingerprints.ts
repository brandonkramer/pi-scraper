/**
 * @fileoverview Migration V2: create element_fingerprints table.
 */
import type { StorageDb } from "../db/open.ts";

export function migrateElementFingerprints(db: StorageDb): void {
	db.db.exec(`
		CREATE TABLE IF NOT EXISTS element_fingerprints (
			identifier TEXT NOT NULL,
			scope TEXT NOT NULL,
			selector TEXT NOT NULL,
			selector_type TEXT NOT NULL,
			source_url TEXT NOT NULL,
			fingerprint_json TEXT NOT NULL,
			stored_at TEXT NOT NULL,
			PRIMARY KEY (identifier, scope)
		);
		CREATE INDEX IF NOT EXISTS idx_fingerprints_scope ON element_fingerprints(scope);
	`);
}
