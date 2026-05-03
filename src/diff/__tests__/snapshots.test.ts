import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScrapeResult } from "../../scrape/pipeline.js";
import { compareSnapshotText } from "../compare.js";
import { diffScrapeResult } from "../snapshots.js";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-diff-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("snapshot diffing", () => {
  it("compares added, removed, changed, and unchanged normalized lines", () => {
    const diff = compareSnapshotText("a\nb\nPrice: $10", "b\nc\nPrice: $12");
    expect(diff.changed.map((entry) => [entry.previous, entry.current])).toEqual([["Price: $10", "Price: $12"]]);
    expect(diff.added).toEqual(["c"]);
    expect(diff.removed).toEqual(["a"]);
    expect(diff.unchanged).toBe(1);
  });

  it("stores deterministic snapshots and diffs the next scrape", async () => {
    await diffScrapeResult(result("https://example.com", "A\nB"), { rootDir });
    const second = await diffScrapeResult(result("https://example.com", "B\nC"), { rootDir });
    expect(second.previous?.content.text).toBe("A\nB");
    expect(second.diff?.added).toEqual(["C"]);
    expect(second.diff?.removed).toEqual(["A"]);
  });
});

function result(url: string, text: string): ScrapeResult {
  return { url, finalUrl: url, status: 200, mode: "fast", format: "markdown", timing: { startedAt: new Date().toISOString() }, truncated: false, data: { route: "html", extractionPath: ["fast"], markdown: text } };
}
