import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrawlFrontier } from "../frontier.js";
import { createCrawlState, loadCrawlState, saveCrawlState } from "../state.js";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-crawl-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("CrawlFrontier", () => {
  it("dedupes and applies same-origin, pattern, and depth limits", () => {
    const frontier = new CrawlFrontier({ seedUrl: "https://example.com", maxDepth: 1, include: ["https://example.com/docs*"], exclude: ["*private*"] });
    expect(frontier.enqueue("https://example.com/docs/a?utm_source=x", 1)).toBe(true);
    expect(frontier.enqueue("https://example.com/docs/a", 1)).toBe(false);
    expect(frontier.enqueue("https://example.com/private", 1)).toBe(false);
    expect(frontier.enqueue("https://other.com/docs", 1)).toBe(false);
    expect(frontier.enqueue("https://example.com/docs/deep", 2)).toBe(false);
    expect(frontier.next()?.url).toBe("https://example.com/docs/a");
  });

  it("persists and reloads crawl state", async () => {
    const state = createCrawlState("https://example.com", "crawl-1");
    state.frontier = [{ url: "https://example.com/a", depth: 1 }];
    await saveCrawlState(state, { rootDir });
    const loaded = await loadCrawlState("crawl-1", { rootDir });
    expect(loaded.frontier[0]?.url).toBe("https://example.com/a");
  });
});
