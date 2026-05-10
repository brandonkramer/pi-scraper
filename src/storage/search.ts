/**
 * @fileoverview storage search module.
 */
import type { ResultEnvelope } from "../types.ts";
import { openStorageDb } from "./db.ts";
import { stringField } from "./_fields.ts";
import type { ResolveStorageOptions } from "./paths.ts";

export interface SearchHit {
	responseId: string;
	url: string;
	title?: string;
	snippet: string;
}

export interface SearchResult {
	supported: boolean;
	reason?: string;
	hits: SearchHit[];
}

let ftsOverride: boolean | undefined;
const initialized = new Set<string>();

export function setFtsAvailabilityForTests(value: boolean | undefined): void {
	ftsOverride = value;
	initialized.clear();
}

export async function fts5Available(
	options: ResolveStorageOptions = {},
): Promise<boolean> {
	if (ftsOverride !== undefined) return ftsOverride;
	const storage = await openStorageDb(options);
	try {
		storage.db.exec(
			"CREATE VIRTUAL TABLE IF NOT EXISTS temp.pi_scraper_fts_probe USING fts5(value)",
		);
		storage.db.exec("DROP TABLE IF EXISTS temp.pi_scraper_fts_probe");
		return true;
	} catch {
		return false;
	}
}

export async function recordStoredSearchText(
	responseId: string,
	value: unknown,
	options: ResolveStorageOptions = {},
): Promise<void> {
	if (!(await fts5Available(options))) return;
	const text = searchableText(value);
	if (!text) return;
	const db = await openStorageDb(options);
	ensureFtsTable(db.db, cacheKey(options));
	const envelope =
		typeof value === "object" && value !== null
			? (value as Partial<ResultEnvelope>)
			: {};
	db.prepare(
		`INSERT OR REPLACE INTO responses_fts (response_id, url, title, text) VALUES (?, ?, ?, ?)`,
	).run(
		responseId,
		stringField(envelope.url) ?? "",
		titleFrom(value) ?? null,
		text,
	);
}

export async function searchStoredScrapes(
	query: string,
	options: ResolveStorageOptions & { limit?: number } = {},
): Promise<SearchResult> {
	if (!(await fts5Available(options))) {
		return {
			supported: false,
			reason: "FTS5 is not compiled into this Node SQLite build.",
			hits: [],
		};
	}
	const db = await openStorageDb(options);
	ensureFtsTable(db.db, cacheKey(options));
	const rows = db.prepare(SEARCH_SQL).all(query, options.limit ?? 10) as Array<{
		response_id: string;
		url: string;
		title: string | null;
		snippet: string;
	}>;
	return {
		supported: true,
		hits: rows.map((row) => ({
			responseId: row.response_id,
			url: row.url,
			title: row.title ?? undefined,
			snippet: row.snippet,
		})),
	};
}

function ensureFtsTable(db: { exec(sql: string): void }, key: string): void {
	if (initialized.has(key)) return;
	db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS responses_fts USING fts5(
  response_id UNINDEXED,
  url UNINDEXED,
  title,
  text
)`);
	initialized.add(key);
}

function searchableText(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value !== "object" || value === null) return undefined;
	const source = value as Partial<ResultEnvelope<Record<string, unknown>>>;
	const data = source.data;
	return firstString(
		data?.text,
		data?.markdown,
		data?.html,
		stringField((value as Record<string, unknown>).text),
		stringField((value as Record<string, unknown>).markdown),
	);
}

function titleFrom(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const source = value as Partial<ResultEnvelope<Record<string, unknown>>>;
	return firstString(
		source.data?.title,
		stringField((value as Record<string, unknown>).title),
	);
}

function firstString(...values: Array<unknown>): string | undefined {
	return values.find(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
}

function cacheKey(options: ResolveStorageOptions): string {
	return options.rootDir ?? "default";
}

const SEARCH_SQL = `SELECT response_id, url, title,
snippet(responses_fts, 3, '[', ']', '…', 12) AS snippet
FROM responses_fts WHERE responses_fts MATCH ? LIMIT ?`;
