/** @file Schema migration dispatcher — reads PRAGMA user_version and runs numbered migrations. */
// oxlint-disable-next-line import/no-cycle -- vertical extractors and storage modules share type contracts; cycle is resolved at call time
import { type StorageDb, wrapDb } from "../db/open.ts";
import { SCHEMA_V1 } from "./001-base-schema.ts";
import { migrateElementFingerprints } from "./002-element-fingerprints.ts";
import { migrateHttpSessions } from "./003-http-sessions.ts";

type DatabaseSync = StorageDb["db"];

export function runMigrations(db: DatabaseSync): void {
	const current = db.prepare("PRAGMA user_version").get() as {
		user_version: number;
	};
	if (current.user_version < 1) {
		runTransactionalMigration(db, () => db.exec(SCHEMA_V1), 1);
	}
	if (current.user_version < 2) {
		runTransactionalMigration(db, () => migrateElementFingerprints(wrapDb(db)), 2);
	}
	if (current.user_version < 3) {
		runTransactionalMigration(db, () => migrateHttpSessions(wrapDb(db)), 3);
	}
}

function runTransactionalMigration(
	db: DatabaseSync,
	migrate: () => void,
	targetVersion: number,
): void {
	db.exec("BEGIN IMMEDIATE");
	try {
		migrate();
		// oxlint-disable-next-line security/detect-sql-injection -- targetVersion is a hardcoded internal migration number, not user input; PRAGMA does not support parameter binding
		db.exec(`PRAGMA user_version = ${targetVersion}`);
		db.exec("COMMIT");
	} catch (error) {
		try {
			db.exec("ROLLBACK");
		} catch {
			/* ignore rollback failures */
		}
		throw error;
	}
}
