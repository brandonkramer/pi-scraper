/**
 * @fileoverview storage cache module.
 */
import type { FetchUrlResult } from "../../http/client.ts";
import { isTextLikeContentType } from "../../http/download.ts";
import { normalizeUrl } from "../../url/normalize.ts";
import { readBlob, writeBlob } from "../blobs.ts";
import { openStorageDb } from "../db.ts";
import {
	DEFAULT_MAX_FRESHNESS_AGE_SECONDS,
	freshnessMetadata,
} from "./freshness.ts";
import type { ResolveStorageOptions } from "../paths.ts";

export interface FetchCacheOptions extends ResolveStorageOptions {
	ttlSeconds?: number;
	maxAgeSeconds?: number;
}

interface FetchRow {
	url_normalized: string;
	final_url: string | null;
	status: number;
	content_type: string | null;
	content_hash: string;
	byte_length: number;
	headers_json: string;
	fetched_at: string;
	expires_at: string | null;
}

export async function findFreshFetch(
	url: string,
	ttlSeconds: number,
	options: FetchCacheOptions = {},
): Promise<FetchUrlResult | null> {
	if (ttlSeconds <= 0) return null;
	const db = await openStorageDb(options);
	const normalized = normalizeUrl(url);
	const row = db.prepare(SELECT_FETCH).get(normalized) as FetchRow | undefined;
	if (!row) return null;
	const fetchedMs = Date.parse(row.fetched_at);
	const ageSeconds = Math.max(0, Math.floor((Date.now() - fetchedMs) / 1_000));
	const freshnessMaxAgeSeconds =
		options.maxAgeSeconds ?? DEFAULT_MAX_FRESHNESS_AGE_SECONDS;
	// Freshness max age is advisory, not a cache-reuse guard: a cached hit can be
	// useful and still stale when callers set maxAgeSeconds stricter than TTL.
	if (ageSeconds > ttlSeconds) return null;
	const body = await readBlob(
		row.content_hash,
		row.content_type ?? undefined,
		options,
	);
	const contentType = row.content_type ?? undefined;
	return {
		url: row.url_normalized,
		finalUrl: row.final_url ?? row.url_normalized,
		status: row.status,
		headers: JSON.parse(row.headers_json) as Record<string, string>,
		contentType,
		body,
		text: isTextLikeContentType(contentType)
			? body.toString("utf8")
			: undefined,
		downloadedBytes: row.byte_length,
		cache: freshnessMetadata(row.fetched_at, ttlSeconds, {
			maxAgeSeconds: freshnessMaxAgeSeconds,
		}),
	};
}

export async function recordFetch(
	result: FetchUrlResult,
	options: FetchCacheOptions = {},
): Promise<void> {
	const ttlSeconds = options.ttlSeconds;
	if (!ttlSeconds || ttlSeconds <= 0 || result.file) return;
	if (shouldNotStore(result.headers["cache-control"])) return;
	const bytes = result.body ?? Buffer.from(result.text ?? "");
	if (bytes.byteLength === 0 && !result.text) return;
	const contentType = result.contentType ?? "application/octet-stream";
	const blob = await writeBlob(bytes, contentType, options);
	const fetchedAt = new Date().toISOString();
	const expiresAt = new Date(
		Date.parse(fetchedAt) + ttlSeconds * 1_000,
	).toISOString();
	const db = await openStorageDb(options);
	db.prepare(INSERT_FETCH).run(
		normalizeUrl(result.url),
		result.finalUrl,
		result.status,
		contentType,
		blob.contentHash,
		blob.byteLength,
		JSON.stringify(result.headers),
		fetchedAt,
		expiresAt,
		result.headers.etag ?? null,
		result.headers["last-modified"] ?? null,
	);
}

function shouldNotStore(cacheControl: string | undefined): boolean {
	const value = cacheControl?.toLowerCase() ?? "";
	return value.includes("no-store") || value.includes("private");
}

const SELECT_FETCH = `SELECT * FROM fetched_responses WHERE url_normalized = ? ORDER BY fetched_at DESC LIMIT 1`;

const INSERT_FETCH = `INSERT OR REPLACE INTO fetched_responses
(url_normalized, final_url, status, content_type, content_hash, byte_length, headers_json, fetched_at, expires_at, etag, last_modified)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
