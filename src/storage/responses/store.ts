/** @file Response storage — write operations and ID reservation. */
import { randomUUID } from "node:crypto";

import type { ResponseStorageMetadata } from "../../types.ts";
import { writeBlob } from "../blobs.ts";
import { openStorageDb } from "../db/open.ts";
import type { ResolveStorageOptions } from "../paths.ts";
import { indexSearchText } from "../search.ts";
import { responseFields } from "./fields.ts";

export interface StoreResponseOptions extends ResolveStorageOptions {
	responseId?: string;
	contentType?: string;
	expiresAt?: string;
	ttlSeconds?: number;
}

export function createResponseId(): string {
	return randomUUID();
}

export async function storeResponseWithId<T>(
	createValue: (responseId: string) => T | Promise<T>,
	options: StoreResponseOptions = {},
): Promise<{ value: T; metadata: ResponseStorageMetadata }> {
	const responseId = options.responseId ?? createResponseId();
	const value = await createValue(responseId);
	const metadata = await storeResponse(value, { ...options, responseId });
	return { value, metadata };
}

export async function storeResponse(
	value: unknown,
	options: StoreResponseOptions = {},
): Promise<ResponseStorageMetadata> {
	const responseId = options.responseId ?? createResponseId();
	const storedAt = new Date().toISOString();
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
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
	await indexSearchText(responseId, value, options);
	return metadata;
}

const UPSERT_RESPONSE = `INSERT OR REPLACE INTO responses
(response_id, url, url_normalized, final_url, content_hash, content_type, status, mode, format, byte_length, stored_at, expires_at, metadata_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function expiresAt(storedAt: string, options: StoreResponseOptions): string | undefined {
	if (options.expiresAt) return options.expiresAt;
	if (options.ttlSeconds && options.ttlSeconds > 0) {
		return new Date(Date.parse(storedAt) + options.ttlSeconds * 1_000).toISOString();
	}
}
