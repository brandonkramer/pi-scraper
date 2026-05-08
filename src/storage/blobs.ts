/**
 * @fileoverview storage blobs module.
 */
import { createHash, randomUUID } from "node:crypto";
import { rename, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	ensureDir,
	pathExists,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "./paths.js";

export interface BlobWriteResult {
	contentHash: string;
	blobPath: string;
	byteLength: number;
	contentType: string;
}

export async function writeBlob(
	bytes: Uint8Array | string,
	contentType = "application/octet-stream",
	options: ResolveStorageOptions = {},
): Promise<BlobWriteResult> {
	const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
	const contentHash = createHash("sha256").update(buffer).digest("hex");
	const target = blobPath(
		contentHash,
		extensionForContentType(contentType),
		options,
	);
	await ensureDir(path.dirname(target));
	if (!(await pathExists(target))) {
		const tmp = path.join(
			path.dirname(target),
			`.${contentHash}.${randomUUID()}.tmp`,
		);
		await writeFile(tmp, buffer, { mode: 0o600 });
		await rename(tmp, target).catch(async (error: unknown) => {
			if (await pathExists(target)) return;
			throw error;
		});
	}
	return {
		contentHash,
		blobPath: target,
		byteLength: buffer.byteLength,
		contentType,
	};
}

export async function readBlob(
	contentHash: string,
	contentType = "application/octet-stream",
	options: ResolveStorageOptions = {},
): Promise<Buffer> {
	return readFile(
		blobPath(contentHash, extensionForContentType(contentType), options),
	);
}

export function blobPath(
	contentHash: string,
	ext = "bin",
	options: ResolveStorageOptions = {},
): string {
	const safeHash = contentHash.replace(/[^a-fA-F0-9]/gu, "").toLowerCase();
	const shard = safeHash.slice(0, 2) || "00";
	return path.join(
		resolvePiStoragePaths(options).root,
		"blobs",
		shard,
		`${safeHash}.${ext}`,
	);
}

export function extensionForContentType(
	contentType: string | undefined,
): string {
	const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
	if (type === "application/json") return "json";
	if (type === "text/html") return "html";
	if (type === "text/markdown") return "md";
	if (type === "text/plain") return "txt";
	if (type === "application/pdf") return "pdf";
	if (type.includes("xml")) return "xml";
	if (type === "image/png") return "png";
	if (type === "image/jpeg") return "jpg";
	if (type === "image/webp") return "webp";
	return "bin";
}

