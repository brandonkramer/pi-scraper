/**
 * @fileoverview crawl __tests__ frontier.test module.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeStorageDbs } from "../../storage/db.js";
import { CrawlFrontier } from "../frontier.js";
import { createCrawlState, loadCrawlState, saveCrawlState } from "../state.js";

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
		expect(frontier.enqueue("https://example.com/docs/a?utm_source=x", 1)).toBe(
			true,
		);
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
		expect(
			existsSync(path.join(rootDir, "crawl", "crawl-1", "state.json")),
		).toBe(false);
	});
});
