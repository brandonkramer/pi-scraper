import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCrawlState, saveCrawlState } from "../../crawl/state.js";
import { closeStorageDbs } from "../../storage/db.js";
import { storeResult } from "../../storage/results.js";
import type { ResultEnvelope } from "../../types.js";
import { diffInterpretation } from "../web-diff.js";
import { webCrawlTool } from "../web-crawl.js";

const signal = new AbortController().signal;
let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-agentic-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	closeStorageDbs();
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
});

describe("agentic response shaping", () => {
	it("web_crawl action=list summarizes recommended actions", async () => {
		await storeResult(
			{ url: "https://example.com", data: "crawl" },
			{ responseId: "crawl-result-1" },
		);
		const state = createCrawlState("https://example.com", "crawl-agentic");
		state.visited = ["https://example.com"];
		state.results = ["https://example.com"];
		state.metadata = {
			...state.metadata!,
			status: "done",
			responseId: "crawl-result-1",
		};
		await saveCrawlState(state);

		const result = await webCrawlTool.execute(
			"call",
			{ action: "list", seed: "https://example.com", limit: 5 },
			signal,
		);
		const envelope = result.details as ResultEnvelope;

		expect(result.content[0]?.text).toContain("recommended action");
		expect(envelope.answerContext).toContain("crawl-agentic");
		expect(envelope.nextActions?.[0]?.tool).toBe("web_crawl");
		expect(envelope.qualitySignals?.freshness).toBe("current");
	});

	it("web_crawl action=status reports one crawl by crawlId", async () => {
		const state = createCrawlState("https://example.com", "crawl-status");
		state.metadata = {
			...state.metadata!,
			status: "running",
		};
		await saveCrawlState(state);

		const result = await webCrawlTool.execute(
			"call",
			{ action: "status", crawlId: "crawl-status" },
			signal,
		);
		const envelope = result.details as ResultEnvelope;

		expect(result.content[0]?.text).toContain("Crawl crawl-status");
		expect(envelope.data).toMatchObject({ crawlId: "crawl-status" });
		expect(envelope.nextActions?.[0]?.tool).toBe("web_crawl");
	});

	it("web_diff interpretation distinguishes baseline, unchanged, and changed states", () => {
		expect(
			diffInterpretation({
				previous: undefined,
				snapshotName: "home",
			} as never),
		).toContain("saved a baseline");
		expect(
			diffInterpretation({
				previous: {},
				summary: { unchangedAfterNormalization: true },
				snapshotName: "home",
			} as never),
		).toContain("No meaningful content changes");
		expect(
			diffInterpretation({
				previous: {},
				diff: { changedCount: 1, addedCount: 2, removedCount: 3 },
				summary: {
					unchangedAfterNormalization: false,
					addedHeadings: ["A"],
					removedHeadings: [],
					addedLinks: [],
					removedLinks: [{}],
				},
				snapshotName: "home",
			} as never),
		).toContain("Content changed");
	});
});
