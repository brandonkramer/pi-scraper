/**
 * @remarks
 *   Uses the existing Node SQLite boundary rather than a separate dependency. Fingerprints are
 *   keyed by (site scope + identifier).
 * @file Persist element fingerprints for adaptive selector repair.
 */
import { openStorageDb } from "./db/open.ts";
import type { ResolveStorageOptions } from "./paths.ts";

export interface StoredFingerprint {
	/** User-provided stable identifier. */
	identifier: string;

	/** Normalized site scope (domain or "default"). */
	scope: string;

	/** JSON-serialized fingerprint. */
	fingerprintJson: string;

	/** Selector that originally matched this element. */
	selector: string;

	/** Selector type: css | xpath | text. */
	selectorType: string;

	/** Source URL where the fingerprint was captured. */
	sourceUrl: string;

	/** ISO timestamp when stored. */
	storedAt: string;
}

/** Save a fingerprint to storage. */
export async function saveFingerprint(
	identifier: string,
	scope: string,
	selector: string,
	selectorType: string,
	sourceUrl: string,
	fingerprintJson: string,
	options: ResolveStorageOptions = {},
): Promise<void> {
	const db = await openStorageDb(options);
	db.transaction(() => {
		db.prepare(
			`
			INSERT OR REPLACE INTO element_fingerprints
			(identifier, scope, selector, selector_type, source_url, fingerprint_json, stored_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			`,
		).run(
			identifier,
			scope,
			selector,
			selectorType,
			sourceUrl,
			fingerprintJson,
			new Date().toISOString(),
		);
	});
}

/** Retrieve a fingerprint by identifier and scope. */
export async function loadFingerprint(
	identifier: string,
	scope: string,
	options: ResolveStorageOptions = {},
): Promise<StoredFingerprint | undefined> {
	const db = await openStorageDb(options);
	const row = db
		.prepare(
			`
			SELECT identifier, scope, selector, selector_type, source_url, fingerprint_json, stored_at
			FROM element_fingerprints
			WHERE identifier = ? AND scope = ?
			`,
		)
		.get(identifier, scope) as
		| {
				identifier: string;
				scope: string;
				selector: string;
				selector_type: string;
				source_url: string;
				fingerprint_json: string;
				stored_at: string;
		  }
		| undefined;

	if (!row) return;
	return {
		identifier: row.identifier,
		scope: row.scope,
		selector: row.selector,
		selectorType: row.selector_type,
		sourceUrl: row.source_url,
		fingerprintJson: row.fingerprint_json,
		storedAt: row.stored_at,
	};
}

/** Delete a fingerprint. */
export async function deleteFingerprint(
	identifier: string,
	scope: string,
	options: ResolveStorageOptions = {},
): Promise<void> {
	const db = await openStorageDb(options);
	db.prepare("DELETE FROM element_fingerprints WHERE identifier = ? AND scope = ?").run(
		identifier,
		scope,
	);
}
