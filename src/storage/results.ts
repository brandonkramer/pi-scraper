import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PI_TRUNCATION_LIMITS } from "../defaults.js";
import type { ResponseStorageMetadata } from "../types.js";
import {
	ensureDir,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "./paths.js";

export interface StoredResult<T = unknown> {
	metadata: ResponseStorageMetadata;
	value: T;
}

export interface StoreResultOptions extends ResolveStorageOptions {
	responseId?: string;
	contentType?: string;
}

export interface TruncatedOutput {
	text: string;
	truncated: boolean;
	metadata?: ResponseStorageMetadata;
}

export async function storeResult<T>(
	value: T,
	options: StoreResultOptions = {},
): Promise<ResponseStorageMetadata> {
	const responseId = options.responseId ?? randomUUID();
	const dir = await ensureDir(resolvePiStoragePaths(options).results);
	const fullOutputPath = path.join(dir, `${safeId(responseId)}.json`);
	const storedAt = new Date().toISOString();
	const valueJson = JSON.stringify(value) ?? "null";
	const metadata: ResponseStorageMetadata = {
		responseId,
		fullOutputPath,
		storedAt,
		byteLength: Buffer.byteLength(valueJson),
		contentType: options.contentType ?? "application/json",
	};
	const storedJson = `{"metadata":${JSON.stringify(metadata)},"value":${valueJson}}\n`;
	await writeFile(fullOutputPath, storedJson, { mode: 0o600 });
	return metadata;
}

export async function getStoredResult<T = unknown>(
	responseId: string,
	options: ResolveStorageOptions = {},
): Promise<StoredResult<T>> {
	const fullOutputPath = path.join(
		resolvePiStoragePaths(options).results,
		`${safeId(responseId)}.json`,
	);
	const parsed = JSON.parse(
		await readFile(fullOutputPath, "utf8"),
	) as StoredResult<T>;
	return parsed;
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

function safeId(responseId: string): string {
	return responseId.replace(/[^a-zA-Z0-9._-]/gu, "_");
}
