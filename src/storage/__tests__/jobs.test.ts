/**
 * @fileoverview storage __tests__ jobs.test module.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createJobManifest,
	getJobManifest,
	updateJobManifest,
	writeJobManifest,
} from "../jobs.ts";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-jobs-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("job manifests", () => {
	it("writes human-readable manifests and removes secret-like params", async () => {
		const manifest = createJobManifest({
			jobId: "crawl-1",
			jobType: "crawl",
			params: {
				url: "https://example.com",
				headers: { authorization: "Bearer secret" },
				cookies: { session: "secret" },
				mode: "fast",
			},
			mode: "fast",
		});

		const filePath = await writeJobManifest(manifest, { rootDir });
		const raw = await readFile(filePath, "utf8");
		const stored = await getJobManifest("crawl-1", { rootDir });

		expect(raw).toContain('\n  "jobId": "crawl-1"');
		expect(raw).not.toContain("secret");
		expect(stored.manifest.params).toEqual({
			url: "https://example.com",
			mode: "fast",
		});
	});

	it("updates counters and response references without duplicating ids", async () => {
		await writeJobManifest(
			createJobManifest({ jobId: "batch-1", jobType: "batch" }),
			{ rootDir },
		);

		const updated = await updateJobManifest(
			"batch-1",
			{
				status: "done",
				urlsProcessed: 3,
				urlsFailed: 1,
				responseIds: ["r1", "r1"],
			},
			{ rootDir },
		);

		expect(updated.manifest.status).toBe("done");
		expect(updated.manifest.urlsProcessed).toBe(3);
		expect(updated.manifest.urlsFailed).toBe(1);
		expect(updated.manifest.responseIds).toEqual(["r1"]);
	});
});
