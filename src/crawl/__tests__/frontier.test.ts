/** @file Crawl **tests** frontier.test module. */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeStorageDbs } from "../../storage/db/open.ts";
import { bestFirstScore, CrawlFrontier } from "../frontier.ts";
import { createCrawlState, loadCrawlState, saveCrawlState } from "../state.ts";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-crawl-"));
});

afterEach(async () => {
	closeStorageDbs();
	await rm(rootDir, { recursive: true, force: true });
});

describe("CrawlFrontier", () => {
	it("dedupes and applies same-origin, pattern, and depth limits", () => {
		const frontier = new CrawlFrontier({
			seedUrl: "https://example.com",
			maxDepth: 1,
			include: ["https://example.com/docs*"],
			exclude: ["*private*"],
		});
		expect(frontier.enqueue("https://example.com/docs/a?utm_source=x", 1)).toBe(true);
		expect(frontier.enqueue("https://example.com/docs/a", 1)).toBe(false);
		expect(frontier.enqueue("https://example.com/private", 1)).toBe(false);
		expect(frontier.enqueue("https://other.com/docs", 1)).toBe(false);
		expect(frontier.enqueue("https://example.com/docs/deep", 2)).toBe(false);
		expect(frontier.next()?.url).toBe("https://example.com/docs/a");
	});

	it("persists and reloads crawl state without rewriting legacy state.json", async () => {
		const state = createCrawlState("https://example.com", "crawl-1");
		state.frontier = [{ url: "https://example.com/a", depth: 1 }];
		await saveCrawlState(state, { rootDir });
		state.frontier.push({ url: "https://example.com/b", depth: 1 });
		state.visited.push("https://example.com");
		await saveCrawlState(state, { rootDir });
		const loaded = await loadCrawlState("crawl-1", { rootDir });
		expect(loaded.frontier.map((item) => item.url)).toEqual([
			"https://example.com/a",
			"https://example.com/b",
		]);
		expect(loaded.visited).toEqual(["https://example.com"]);
		expect(existsSync(path.join(rootDir, "crawl", "crawl-1", "state.json"))).toBe(false);
	});

	describe("strategy: bfs", () => {
		it("crawls breadth-first by default (FIFO)", () => {
			const frontier = new CrawlFrontier({
				seedUrl: "https://example.com",
			});
			expect(frontier.enqueue("https://example.com/a", 1)).toBe(true);
			expect(frontier.enqueue("https://example.com/b", 1)).toBe(true);
			expect(frontier.enqueue("https://example.com/c", 1)).toBe(true);
			expect(frontier.next()?.url).toBe("https://example.com/a");
			expect(frontier.next()?.url).toBe("https://example.com/b");
			expect(frontier.next()?.url).toBe("https://example.com/c");
			expect(frontier.next()).toBeUndefined();
		});
	});

	describe("strategy: dfs", () => {
		it("crawls depth-first (LIFO)", () => {
			const frontier = new CrawlFrontier({
				seedUrl: "https://example.com",
				strategy: "dfs",
			});
			expect(frontier.enqueue("https://example.com/a", 1)).toBe(true);
			expect(frontier.enqueue("https://example.com/b", 1)).toBe(true);
			expect(frontier.enqueue("https://example.com/c", 1)).toBe(true);
			expect(frontier.next()?.url).toBe("https://example.com/c");
			expect(frontier.next()?.url).toBe("https://example.com/b");
			expect(frontier.next()?.url).toBe("https://example.com/a");
			expect(frontier.next()).toBeUndefined();
		});

		it("drills deep before visiting siblings", () => {
			const frontier = new CrawlFrontier({
				seedUrl: "https://example.com",
				maxDepth: 3,
				strategy: "dfs",
			});
			expect(frontier.enqueue("https://example.com/section", 1)).toBe(true);
			expect(frontier.enqueue("https://example.com/other", 1)).toBe(true);
			expect(frontier.next()?.url).toBe("https://example.com/other");
			// Enqueue deep children under the just-yielded URL
			expect(frontier.enqueue("https://example.com/other/deep", 2)).toBe(true);
			expect(frontier.enqueue("https://example.com/other/sibling", 2)).toBe(true);
			// DFS visits deep first, then sibling
			expect(frontier.next()?.url).toBe("https://example.com/other/sibling");
			expect(frontier.next()?.url).toBe("https://example.com/other/deep");
			expect(frontier.next()?.url).toBe("https://example.com/section");
		});
	});

	describe("strategy: best-first", () => {
		it("orders by priority score (index > section > deep content)", () => {
			const frontier = new CrawlFrontier({
				seedUrl: "https://example.com",
				strategy: "best-first",
				maxDepth: 3,
			});
			expect(frontier.enqueue("https://example.com/deep/page", 2)).toBe(true);
			expect(frontier.enqueue("https://example.com/", 0)).toBe(true);
			expect(frontier.enqueue("https://example.com/section", 1)).toBe(true);
			// Index/root URL has highest score
			expect(frontier.next()?.url).toBe("https://example.com/");
			// Section has next highest
			expect(frontier.next()?.url).toBe("https://example.com/section");
			// Deep page last
			expect(frontier.next()?.url).toBe("https://example.com/deep/page");
			expect(frontier.next()).toBeUndefined();
		});
	});

	describe("bestFirstScore", () => {
		it("scores root URL highest", () => {
			const score = bestFirstScore({ url: "https://example.com/", depth: 0 });
			// (5-0)*10 + 5 = 55
			expect(score).toBeGreaterThan(40);
		});

		it("scores section pages above deep content", () => {
			const section = bestFirstScore({
				url: "https://example.com/docs",
				depth: 1,
			});
			const deep = bestFirstScore({
				url: "https://example.com/docs/guides/advanced",
				depth: 2,
			});
			expect(section).toBeGreaterThan(deep);
		});

		it("scores shallower depth higher", () => {
			const d0 = bestFirstScore({ url: "https://example.com/page", depth: 0 });
			const d2 = bestFirstScore({ url: "https://example.com/page", depth: 2 });
			expect(d0).toBeGreaterThan(d2);
		});
	});
});
