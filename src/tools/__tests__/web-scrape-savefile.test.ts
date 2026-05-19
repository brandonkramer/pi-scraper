/** @file Web-scrape saveToFile test module. */
import { describe, expect, it } from "vitest";

import { createWebScrapeTool } from "../web-scrape.ts";

describe("web_scrape saveToFile schema", () => {
	it("schema includes saveToFile param", () => {
		const tool = createWebScrapeTool();
		const schema = tool.parameters as { properties?: Record<string, unknown> };
		const props = schema.properties ?? {};
		expect(props).toHaveProperty("saveToFile");
	});

	it("saveToFile param description mentions disk storage", () => {
		const tool = createWebScrapeTool();
		const schema = tool.parameters as { properties?: Record<string, unknown> };
		const props = schema.properties ?? {};
		const saveToFile = props.saveToFile as { description?: string };
		expect(saveToFile.description).toContain("disk storage");
	});
});

describe("saveBodyToDownloads integration", () => {
	it("derives filename from URL", async () => {
		const { deriveFilename } = await import("../../http/download-storage.ts");
		expect(deriveFilename("https://example.com/report.pdf", "application/pdf")).toBe("report.pdf");
	});

	it("sanitizes dangerous filenames", async () => {
		const { sanitizeFilename } = await import("../../http/download-storage.ts");
		expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
	});

	it("streams body to content-addressed file", async () => {
		const { saveBodyToDownloads } = await import("../../http/download-storage.ts");
		const { Readable } = await import("node:stream");
		const { readFile, mkdir, rm } = await import("node:fs/promises");
		const path = await import("node:path");

		const testDir = path.join(
			import.meta.dirname,
			"..",
			"..",
			"..",
			".test-tmp",
			"savefile-integration",
		);
		await mkdir(testDir, { recursive: true });

		const content = Buffer.from("integration test body");
		const body = Readable.from([content]);
		const result = await saveBodyToDownloads(
			body,
			"text/plain",
			"https://example.com/test.txt",
			undefined,
			{ dir: testDir },
		);

		expect(result.bytes).toBe(21);
		expect(result.filePath).toContain(testDir);
		expect(result.filePath).toContain("test.txt");

		const saved = await readFile(result.filePath);
		expect(saved.toString()).toBe("integration test body");

		await rm(testDir, { recursive: true, force: true });
	});
});
