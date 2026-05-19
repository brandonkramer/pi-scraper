/** @file Content-addressed streaming download storage with TTL cleanup. */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { resolvePiStoragePaths } from "../storage/paths.ts";
import { BodySizeLimitError } from "./download.ts";

const HEX_PREFIX_LENGTH = 2;
// 7 days
const MAX_FILENAME_BYTES = 200;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SaveToFileOptions {
	dir?: string;
	filename?: string;
	maxBytes?: number;
}

export interface DownloadResult {
	filePath: string;
	bytes: number;
	contentType?: string;
	sha256?: string;
}

/** Returns the base directory for content-addressed downloads. Defaults to ~/.pi/scraper/downloads/. */
export function getDownloadsBaseDir(override?: string): string {
	if (override) return path.resolve(override);
	return resolvePiStoragePaths().downloads;
}

/**
 * Derive a safe filename from response properties. Priority: explicit name > Content-Disposition >
 * URL basename > fallback.
 */
export function deriveFilename(
	url: string,
	contentType?: string,
	disposition?: string,
	override?: string,
): string {
	if (override) return sanitizeFilename(override);

	if (disposition) {
		const match = disposition.match(/(?:^|;)\s*filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/iu);
		if (match?.[1]) {
			// filename*= uses URL-encoding (RFC 5987); filename= is plain
			const isRfc5987 = /filename\*=/iu.test(disposition);
			const raw = match[1].trim();
			const decoded = isRfc5987 ? decodeURIComponent(raw) : raw;
			return sanitizeFilename(decoded);
		}
	}

	try {
		const urlPath = new URL(url).pathname;
		const basename = urlPath.match(/\/([^/]+)$/u)?.[1];
		if (basename && basename.length > 0 && basename !== "/") {
			const decoded = decodeURIComponent(basename);
			const cleaned = sanitizeFilename(decoded);
			// Append extension from content-type if basename lacks one
			if (!cleaned.includes(".")) {
				return cleaned + extFromContentType(contentType);
			}
			return cleaned;
		}
	} catch {
		// invalid URL — fall through
	}

	const ext = extFromContentType(contentType);
	return `download${ext}`;
}

function extFromContentType(contentType?: string): string {
	if (!contentType) return ".bin";
	const map: Record<string, string> = {
		"application/pdf": ".pdf",
		"application/zip": ".zip",
		"application/gzip": ".gz",
		"application/x-tar": ".tar",
		"application/x-gtar": ".tar.gz",
		"image/jpeg": ".jpg",
		"image/png": ".png",
		"image/gif": ".gif",
		"image/webp": ".webp",
		"image/svg+xml": ".svg",
		"video/mp4": ".mp4",
		"audio/mpeg": ".mp3",
		"application/json": ".json",
		"text/csv": ".csv",
		"text/markdown": ".md",
		"text/plain": ".txt",
		"text/html": ".html",
	};
	const base = contentType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
	return map[base] ?? ".bin";
}

/**
 * Sanitize a filename to prevent path traversal and other attacks. Strips control characters,
 * parent directory references, and caps length.
 */
export function sanitizeFilename(name: string): string {
	const basename = name.split(/[/\\]/u).pop() ?? "download";
	const cleaned = basename
		// oxlint-disable-next-line eslint/no-control-regex -- intentional: strip control chars for path safety
		.replaceAll(/[\u0000-\u001F\u007F]/gu, "")
		.replace(/^\.+/u, "")
		.replaceAll(/~+/gu, "")
		.trim();
	if (cleaned.length === 0) return "download";
	if (Buffer.byteLength(cleaned, "utf8") > MAX_FILENAME_BYTES) {
		return cleaned.slice(0, MAX_FILENAME_BYTES);
	}
	return cleaned;
}

/**
 * Stream a response body to a content-addressed file in the downloads directory. Path:
 * <base>/<hex-prefix>/<filename> Deduplicates: reuses existing file with same sha256 prefix.
 */
export async function saveBodyToDownloads(
	body: AsyncIterable<Uint8Array>,
	contentType: string | undefined,
	url: string,
	fetchHeaders: Record<string, string> | undefined,
	options: SaveToFileOptions = {},
): Promise<DownloadResult> {
	const baseDir = getDownloadsBaseDir(options.dir);
	// 50MB default
	const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
	const disposition = fetchHeaders?.["content-disposition"];
	const filename = deriveFilename(url, contentType, disposition, options.filename);

	let downloadedBytes = 0;
	const hasher = createHash("sha256");
	const chunks: Buffer[] = [];

	for await (const chunk of body) {
		downloadedBytes += chunk.byteLength;
		if (downloadedBytes > maxBytes) {
			throw new BodySizeLimitError(maxBytes, downloadedBytes);
		}
		const buf = Buffer.from(chunk);
		hasher.update(buf);
		chunks.push(buf);
	}

	const hexDigest = hasher.digest("hex");
	const prefix = hexDigest.slice(0, HEX_PREFIX_LENGTH);
	const prefixDir = path.join(baseDir, prefix);
	await mkdir(prefixDir, { recursive: true, mode: 0o700 });

	const filePath = path.join(prefixDir, filename);

	// If the file already exists (same prefix + name), assume dedup
	try {
		await stat(filePath);
		return { filePath, bytes: downloadedBytes, contentType, sha256: hexDigest };
	} catch {
		// file doesn't exist — write it
	}

	const combined = Buffer.concat(chunks);
	await mkdir(prefixDir, { recursive: true, mode: 0o700 });
	await pipeline(Readable.from([combined]), createWriteStream(filePath, { mode: 0o600 }));

	return { filePath, bytes: downloadedBytes, contentType, sha256: hexDigest };
}

/** Remove downloaded files older than maxAgeMs (default 7 days). Returns count of removed files. */
export async function cleanupOldDownloads(maxAgeMs?: number, baseDir?: string): Promise<number> {
	const age = maxAgeMs ?? DEFAULT_TTL_MS;
	baseDir ??= getDownloadsBaseDir();
	const cutoff = Date.now() - age;
	let removed = 0;

	let prefixDirs: string[];
	try {
		prefixDirs = await readdir(baseDir, { withFileTypes: true }).then((entries) =>
			entries.filter((e) => e.isDirectory()).map((e) => path.join(baseDir, e.name)),
		);
	} catch {
		// directory doesn't exist yet
		return 0;
	}

	for (const dir of prefixDirs) {
		let files: string[];
		try {
			files = await readdir(dir);
		} catch {
			continue;
		}
		for (const file of files) {
			const filePath = path.join(dir, file);
			try {
				const stats = await stat(filePath);
				if (stats.isFile() && stats.mtimeMs < cutoff) {
					await unlink(filePath);
					removed++;
				}
			} catch {
				// race with concurrent access — skip
			}
		}
		// Remove empty prefix directories
		try {
			const remaining = await readdir(dir);
			if (remaining.length === 0) {
				await unlink(dir).catch(() => null);
			}
		} catch {
			// ignore
		}
	}

	return removed;
}

export async function computeSha256(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath);
	for await (const chunk of stream) {
		hash.update(chunk);
	}
	return hash.digest("hex");
}
