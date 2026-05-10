/**
 * @fileoverview Response read operations.
 */
import type { ResponseStorageMetadata } from "../../types.ts";
import { readBlob } from "../blobs.ts";
import { openStorageDb } from "../db.ts";
import type { ResolveStorageOptions } from "../paths.ts";

export interface StoredResponse<T = unknown> {
	metadata: ResponseStorageMetadata;
	value: T;
}

interface ResponseRow {
	metadata_json: string;
	content_hash: string;
	content_type: string | null;
}

export async function readResponse<T = unknown>(
	responseId: string,
	options: ResolveStorageOptions = {},
): Promise<StoredResponse<T>> {
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
