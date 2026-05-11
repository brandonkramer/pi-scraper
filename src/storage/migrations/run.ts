/** @file Schema migration dispatcher — reads PRAGMA user_version and runs numbered migrations. */
import type { DatabaseSync } from "node:sqlite";

// oxlint-disable-next-line import/no-cycle -- vertical extractors and storage modules share type contracts; cycle is resolved at call time
import { wrapDb } from "../db/open.ts";
import { SCHEMA_V1 } from "./001-base-schema.ts";
import { migrateElementFingerprints } from "./002-element-fingerprints.ts";
import { migrateHttpSessions } from "./003-http-sessions.ts";

export function runMigrations(db: DatabaseSync): void {
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
