/**
 * @fileoverview storage results module.
 */
import { randomUUID } from "node:crypto";
import { PI_TRUNCATION_LIMITS } from "../defaults.ts";
import type { ResponseStorageMetadata } from "../types.ts";
import { readBlob, writeBlob } from "./blobs.ts";
import { openStorageDb } from "./db.ts";
import { normalizeMaybe, numberField, stringField } from "./_fields.ts";
import type { ResolveStorageOptions } from "./paths.ts";
import { recordStoredSearchText } from "./search.ts";

export interface StoredResult<T = unknown> {
	metadata: ResponseStorageMetadata;
	value: T;
}

export interface StoreResultOptions extends ResolveStorageOptions {
	responseId?: string;
	contentType?: string;
	expiresAt?: string;
	ttlSeconds?: number;
}

export interface TruncatedOutput {
	text: string;
	truncated: boolean;
	metadata?: ResponseStorageMetadata;
}

interface ResponseRow {
	metadata_json: string;
	content_hash: string;
	content_type: string | null;
}

/**
 * Reserves the response identifier used for a stored result.
 *
 * @remarks
 * Use when a payload needs to include its own responseId before it is written.
 */
export function createResponseId(): string {
	return randomUUID();
}

/**
 * Stores a payload that needs to know its responseId before serialization.
 *
 * @remarks
 * This avoids speculative store-then-mutate-then-store flows for self-referential
 * tool payloads. The final fullOutputPath is still returned as storage metadata.
 */
export async function storeResultWithResponseId<T>(
	createValue: (responseId: string) => T | Promise<T>,
	options: StoreResultOptions = {},
): Promise<{ value: T; metadata: ResponseStorageMetadata }> {
	const responseId = options.responseId ?? createResponseId();
	const value = await createValue(responseId);
	const metadata = await storeResult(value, { ...options, responseId });
	return { value, metadata };
}

export async function storeResult<T>(
	value: T,
	options: StoreResultOptions = {},
): Promise<ResponseStorageMetadata> {
	const responseId = options.responseId ?? createResponseId();
	const storedAt = new Date().toISOString();
	const valueJson = JSON.stringify(value) ?? "null";
	const contentType = options.contentType ?? "application/json";
	const blob = await writeBlob(valueJson, contentType, options);
	const metadata: ResponseStorageMetadata = {
		responseId,
		fullOutputPath: blob.blobPath,
		storedAt,
		byteLength: blob.byteLength,
		contentType,
	};
	const fields = responseFields(value, responseId);
	const db = await openStorageDb(options);
	db.prepare(UPSERT_RESPONSE).run(
		responseId,
		fields.url,
		fields.urlNormalized,
		fields.finalUrl ?? null,
		blob.contentHash,
		contentType,
		fields.status ?? null,
		fields.mode ?? null,
		fields.format ?? null,
		blob.byteLength,
		storedAt,
		expiresAt(storedAt, options) ?? null,
		JSON.stringify(metadata),
	);
	await recordStoredSearchText(responseId, value, options);
	return metadata;
}

export async function getStoredResult<T = unknown>(
	responseId: string,
	options: ResolveStorageOptions = {},
): Promise<StoredResult<T>> {
	const db = await openStorageDb(options);
	const row = db
		.prepare(
			"SELECT metadata_json, content_hash, content_type FROM responses WHERE response_id = ?",
		)
		.get(responseId) as ResponseRow | undefined;
	if (!row) throw new Error(`Stored result not found: ${responseId}`);
	const metadata = JSON.parse(row.metadata_json) as ResponseStorageMetadata;
	const value = JSON.parse(
		(
			await readBlob(row.content_hash, row.content_type ?? undefined, options)
		).toString("utf8"),
	) as T;
	return { metadata, value };
}

export async function truncateAndStore(
	text: string,
	value: unknown,
	options: StoreResultOptions = {},
): Promise<TruncatedOutput> {
	const limits = PI_TRUNCATION_LIMITS;
	const byteLength = Buffer.byteLength(text);
	const lineLimited = firstLines(text, limits.maxLines);
	const overBytes = byteLength > limits.maxBytes;
	const overLines = lineLimited.length < text.length;
	if (!overBytes && !overLines) return { text, truncated: false };

	const metadata = await storeResult(value, options);
	return {
		text: trimToBytes(lineLimited, limits.maxBytes),
		truncated: true,
		metadata,
	};
}

function responseFields(value: unknown, responseId: string) {
	const source =
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	const url =
		stringField(source.url) ??
		stringField(source.finalUrl) ??
		`urn:response:${responseId}`;
	const finalUrl = stringField(source.finalUrl);
	return {
		url,
		urlNormalized: normalizeMaybe(url),
		finalUrl,
		status: numberField(source.status),
		mode: stringField(source.mode),
		format: stringField(source.format),
	};
}

function expiresAt(
	storedAt: string,
	options: StoreResultOptions,
): string | undefined {
	if (options.expiresAt) return options.expiresAt;
	if (options.ttlSeconds && options.ttlSeconds > 0) {
		return new Date(
			Date.parse(storedAt) + options.ttlSeconds * 1_000,
		).toISOString();
	}
	return undefined;
}

function firstLines(text: string, maxLines: number): string {
	if (maxLines <= 0) return "";
	let lines = 1;
	for (const match of text.matchAll(/\r?\n/gu)) {
		if (lines >= maxLines) return text.slice(0, match.index);
		lines += 1;
	}
	return text;
}

function trimToBytes(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text) <= maxBytes) return text;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(text.slice(0, mid)) <= maxBytes) low = mid;
		else high = mid - 1;
	}
	return text.slice(0, low);
}

const UPSERT_RESPONSE = `INSERT OR REPLACE INTO responses
(response_id, url, url_normalized, final_url, content_hash, content_type, status, mode, format, byte_length, stored_at, expires_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
