import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCrawlState, saveCrawlState } from "../../crawl/state.js";
import { closeStorageDbs } from "../../storage/db.js";
import { storeResult } from "../../storage/results.js";
import {
	fts5Available,
	setFtsAvailabilityForTests,
} from "../../storage/search.js";
import type { ResultEnvelope } from "../../types.js";
import { diffInterpretation } from "../web-diff.js";
import { webCrawlsTool } from "../web-crawls.js";
import { webHistoryTool } from "../web-history.js";
import { webSearchScrapesTool } from "../web-search-scrapes.js";

const signal = new AbortController().signal;
let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-agentic-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	setFtsAvailabilityForTests(undefined);
	closeStorageDbs();
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
});

describe("agentic response shaping", () => {
	it("web_history returns reuse context and retrieve/refresh actions", async () => {
		const stored = await storeResult({
			url: "https://example.com",
			status: 200,
			mode: "fast",
			format: "markdown",
			data: { markdown: "# Example Domain" },
		});

		const result = await webHistoryTool.execute(
			"call",
			{ url: "https://example.com", limit: 5 },
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			entries: Array<{ responseId?: string }>;
		}>;

		expect(result.content[0]?.text).toContain("Latest stored scrape");
		expect(envelope.answerContext).toContain(stored.responseId);
		expect(envelope.nextActions?.map((action) => action.action)).toEqual(
			expect.arrayContaining(["retrieve", "refresh"]),
		);
		expect(envelope.data.entries[0]?.responseId).toBe(stored.responseId);
	});

	it("web_search_scrapes reports unsupported FTS as a quality gap", async () => {
		setFtsAvailabilityForTests(false);
		const result = await webSearchScrapesTool.execute(
			"call",
			{ query: "Example Domain", limit: 5 },
			signal,
		);
		const envelope = result.details as ResultEnvelope;

		expect(result.content[0]?.text).toContain("unavailable");
		expect(envelope.qualitySignals?.knownGaps?.[0]).toContain("FTS5");
		expect(envelope.answerContext).toContain("could not run");
	});

	it("web_search_scrapes includes snippets and source notes when FTS is available", async () => {
		if (!(await fts5Available())) return;
		await storeResult({
			url: "https://example.com",
			status: 200,
			mode: "fast",
			format: "markdown",
			data: {
				title: "Example Domain",
				markdown: "Example Domain text for documentation examples.",
			},
		});

		const result = await webSearchScrapesTool.execute(
			"call",
			{ query: "Example", limit: 5 },
			signal,
		);
		const envelope = result.details as ResultEnvelope;

		expect(result.content[0]?.text).toContain("Top hit");
		expect(envelope.answerContext).toContain("responseId");
		expect(envelope.sourceNotes?.[0]?.excerpt).toBeTruthy();
		expect(envelope.nextActions?.[0]?.action).toBe("retrieve");
	});

	it("web_crawls summarizes recommended actions and retrieval handles", async () => {
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

		const result = await webCrawlsTool.execute(
			"call",
			{ seed: "https://example.com", limit: 5 },
			signal,
		);
		const envelope = result.details as ResultEnvelope;

		expect(result.content[0]?.text).toContain("recommended action");
		expect(envelope.answerContext).toContain("crawl-agentic");
		expect(envelope.nextActions?.[0]?.tool).toBe("web_get_result");
		expect(envelope.qualitySignals?.freshness).toBe("current");
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
