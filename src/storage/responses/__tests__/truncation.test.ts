/** @file Tools **tests** truncation.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PI_TRUNCATION_LIMITS } from "../../../defaults.ts";
import { closeStorageDbs } from "../../db/open.ts";
import { readResponse } from "../read.ts";
import { truncateAndStore } from "../truncate.ts";

let rootDir: string;
let originalStorageRoot: string | undefined;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-truncation-"));
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	await closeStorageDbs();
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
	await rm(rootDir, { recursive: true, force: true });
});

describe("truncated full output storage", () => {
	it("stores byte-limited output and preserves the full payload by responseId", async () => {
		const fullText = `${"x".repeat(PI_TRUNCATION_LIMITS.maxBytes + 1024)}\n${Array.from({ length: PI_TRUNCATION_LIMITS.maxLines + 10 }, (_, index) => `line ${index}`).join("\n")}`;
		const payload = { kind: "large-output", text: fullText };

		const truncated = await truncateAndStore(fullText, payload);

		expect(truncated.truncated).toBe(true);
		expect(truncated.text.length).toBeLessThan(fullText.length);
		expect(truncated.metadata?.responseId).toBeTruthy();
		expect(truncated.metadata?.fullOutputPath).toContain(path.join(rootDir, "blobs"));

		const retrieved = await readResponse<typeof payload>(responseIdFrom(truncated));

		expect(retrieved.value.kind).toBe("large-output");
		expect(retrieved.value.text.length).toBe(fullText.length);
	});
});

function responseIdFrom(result: Awaited<ReturnType<typeof truncateAndStore>>): string {
	const responseId = result.metadata?.responseId;
	if (!responseId) throw new Error("Expected stored responseId");
	return responseId;
}
