/**
 * @fileoverview http download module.
 */
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export interface BinaryDownloadMetadata {
	path: string;
	contentType?: string;
	downloadedBytes: number;
}

export class BodySizeLimitError extends Error {
	constructor(
		readonly maxBytes: number,
		readonly downloadedBytes: number,
	) {
		super(`Response exceeded maxBytes (${downloadedBytes} > ${maxBytes})`);
		this.name = "BodySizeLimitError";
	}
}

export function normalizeHeaders(
	headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (Array.isArray(value)) {
			normalized[key.toLowerCase()] = value.join(", ");
		} else if (typeof value === "string") {
			normalized[key.toLowerCase()] = value;
		}
	}
	return normalized;
}

export function enforceContentLength(
	contentLength: string | undefined,
	maxBytes: number,
): void {
	const length = contentLength
		? Number.parseInt(contentLength, 10)
		: Number.NaN;
	if (Number.isFinite(length) && length > maxBytes) {
		throw new BodySizeLimitError(maxBytes, length);
	}
}

export function isTextLikeContentType(
	contentType: string | undefined,
): boolean {
	if (!contentType) {
		return false;
	}
	const value = contentType.toLowerCase();
	return (
		value.startsWith("text/") ||
		value.includes("json") ||
		value.includes("xml") ||
		value.includes("javascript") ||
		value.includes("svg") ||
		value.includes("markdown") ||
		value.includes("x-www-form-urlencoded")
	);
}

export function isPdfContentType(contentType: string | undefined): boolean {
	return (
		contentType?.toLowerCase().split(";", 1)[0]?.trim() === "application/pdf"
	);
}

export async function collectBody(
	body: AsyncIterable<Uint8Array>,
	maxBytes: number,
): Promise<{ buffer: Buffer; downloadedBytes: number }> {
	const chunks: Buffer[] = [];
	let downloadedBytes = 0;
	for await (const chunk of body) {
		downloadedBytes += chunk.byteLength;
		if (downloadedBytes > maxBytes) {
			throw new BodySizeLimitError(maxBytes, downloadedBytes);
		}
		chunks.push(Buffer.from(chunk));
	}
	return { buffer: Buffer.concat(chunks), downloadedBytes };
}

export async function streamToTempFile(
	body: AsyncIterable<Uint8Array>,
	options: { maxBytes: number; contentType?: string; extension?: string },
): Promise<BinaryDownloadMetadata> {
	const dir = path.join(tmpdir(), "pi-scraper-downloads");
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const filePath = path.join(
		dir,
		`${randomUUID()}${options.extension ?? ".bin"}`,
	);
	let downloadedBytes = 0;

	const limited = async function* (): AsyncGenerator<Uint8Array> {
		for await (const chunk of body) {
			downloadedBytes += chunk.byteLength;
			if (downloadedBytes > options.maxBytes) {
				throw new BodySizeLimitError(options.maxBytes, downloadedBytes);
			}
			yield chunk;
		}
	};

	await pipeline(
		Readable.from(limited()),
		createWriteStream(filePath, { mode: 0o600 }),
	);
	const fileStat = await stat(filePath);
	return {
		path: filePath,
		contentType: options.contentType,
		downloadedBytes: fileStat.size,
	};
}
