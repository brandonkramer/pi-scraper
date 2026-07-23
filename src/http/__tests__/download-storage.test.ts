/** @file Download-storage test module. */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	cleanupOldDownloads,
	deriveFilename,
	getDownloadsBaseDir,
	sanitizeFilename,
	saveBodyToDownloads,
} from "../download-storage.ts";

const TEST_DIR = path.join(import.meta.dirname, "..", "..", "..", ".test-tmp", "download-storage");

describe("sanitizeFilename", () => {
	it("strips path traversal", () => {
		// Only basename is kept; directories are stripped
		expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
	});

	it("strips leading dots", () => {
		expect(sanitizeFilename(".hidden")).toBe("hidden");
	});

	it("strips control characters", () => {
		expect(sanitizeFilename("file\u0000name")).toBe("filename");
	});

	it("keeps normal filename", () => {
		expect(sanitizeFilename("paper.pdf")).toBe("paper.pdf");
	});

	it("handles spaces", () => {
		expect(sanitizeFilename("my file.txt")).toBe("my file.txt");
	});

	it("falls back to download for empty input", () => {
		expect(sanitizeFilename("")).toBe("download");
	});

	it("caps at 200 bytes", () => {
		const long = "a".repeat(300);
		expect(Buffer.byteLength(sanitizeFilename(long), "utf8")).toBeLessThanOrEqual(200);
	});
});

describe("deriveFilename", () => {
	it("uses override first", () => {
		expect(
			deriveFilename("https://example.com/file.pdf", "application/pdf", undefined, "custom.txt"),
		).toBe("custom.txt");
	});

	it("parses Content-Disposition", () => {
		expect(
			deriveFilename(
				"https://example.com/download",
				undefined,
				'attachment; filename="report.pdf"',
			),
		).toBe("report.pdf");
	});

	it("parses Content-Disposition filename* (RFC 5987)", () => {
		expect(
			deriveFilename(
				"https://example.com/download",
				undefined,
				"attachment; filename*=UTF-8''%E2%82%ACrate.pdf",
			),
		).toBe("€rate.pdf");
	});

	it("falls back to URL basename", () => {
		expect(deriveFilename("https://example.com/papers/large.pdf", "application/pdf")).toBe(
			"large.pdf",
		);
	});

	it("decodes URL-encoded basename", () => {
		expect(deriveFilename("https://example.com/my%20file.pdf")).toBe("my file.pdf");
	});

	it("falls back to generic name with extension from content-type", () => {
		expect(deriveFilename("https://example.com/download", "application/zip")).toBe("download.zip");
	});

	it("falls back to download.bin without content-type", () => {
		expect(deriveFilename("https://example.com/download")).toBe("download.bin");
	});
});

describe("getDownloadsBaseDir", () => {
	it("uses override when provided", () => {
		expect(getDownloadsBaseDir("/tmp/custom")).toBe(path.resolve("/tmp/custom"));
	});

	it("defaults to ~/.pi/scraper/downloads", () => {
		const dir = getDownloadsBaseDir();
		expect(dir).toContain(path.join(".pi", "scraper", "downloads"));
	});
});

describe("saveBodyToDownloads", () => {
	const testDir = path.join(TEST_DIR, "save");

	beforeAll(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterAll(async () => {
		await cleanupOldDownloads(0, testDir);
	});

	it("saves body to content-addressed path", async () => {
		const content = Buffer.from("hello world");
		const body = Readable.from([content]);

		const result = await saveBodyToDownloads(
			body,
			"text/plain",
			"https://example.com/file.txt",
			undefined,
			{
				dir: testDir,
			},
		);

		expect(result.bytes).toBe(11);
		expect(result.contentType).toBe("text/plain");
		expect(result.sha256).toBe(createHash("sha256").update(content).digest("hex"));
		expect(result.filePath).toContain(result.sha256!.slice(0, 2));

		const saved = await readFile(result.filePath);
		expect(saved.toString()).toBe("hello world");
	});

	it("uses filename override", async () => {
		const content = Buffer.from("override test");
		const body = Readable.from([content]);

		const result = await saveBodyToDownloads(
			body,
			"text/plain",
			"https://example.com/file.txt",
			undefined,
			{
				dir: testDir,
				filename: "custom.txt",
			},
		);

		expect(result.filePath).toContain("custom.txt");
	});

	it("throws BodySizeLimitError when exceeding maxBytes", async () => {
		const large = randomBytes(10 * 1024);
		const body = Readable.from([large]);

		await expect(
			saveBodyToDownloads(
				body,
				"application/octet-stream",
				"https://example.com/large",
				undefined,
				{
					dir: testDir,
					maxBytes: 100,
				},
			),
		).rejects.toThrow("maxBytes");
	});

	it("deduplicates identical content (same prefix + filename)", async () => {
		const content = Buffer.from("dedup content");
		const body1 = Readable.from([content]);
		const body2 = Readable.from([content]);

		const r1 = await saveBodyToDownloads(
			body1,
			"text/plain",
			"https://example.com/dedup.txt",
			undefined,
			{
				dir: testDir,
			},
		);
		const r2 = await saveBodyToDownloads(
			body2,
			"text/plain",
			"https://example.com/dedup.txt",
			undefined,
			{
				dir: testDir,
			},
		);

		expect(r1.filePath).toBe(r2.filePath);
	});
});

describe("cleanupOldDownloads", () => {
	const testDir = path.join(TEST_DIR, "cleanup");

	beforeAll(async () => {
		await mkdir(testDir, { recursive: true });
	});

	it("removes files older than cutoff", async () => {
		const prefixDir = path.join(testDir, "ab");
		await mkdir(prefixDir, { recursive: true });

		// Write old file with mtime set to 8 days ago
		const oldFile = path.join(prefixDir, "old.txt");
		await writeFile(oldFile, "old data");
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		await utimes(oldFile, eightDaysAgo, eightDaysAgo);

		// Write fresh file (current mtime)
		const freshFile = path.join(prefixDir, "fresh.txt");
		await writeFile(freshFile, "fresh data");

		// Default 7-day TTL should catch the 8-day-old file
		const removed = await cleanupOldDownloads(undefined, testDir);
		expect(removed).toBe(1);
	});
});
