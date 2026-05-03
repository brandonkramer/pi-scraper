import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../runner.js";
import { loadCrawlState } from "../state.js";
import type { FetchUrlResult } from "../../http/client.js";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-runner-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

function html(url: string, body: string): FetchUrlResult {
  return { url, finalUrl: url, status: 200, headers: { "content-type": "text/html" }, contentType: "text/html", text: body, downloadedBytes: body.length };
}

describe("runCrawl", () => {
  it("crawls breadth-first basics through shared scrape pipeline", async () => {
    const result = await runCrawl("https://example.com", { rootDir, crawlId: "c1", maxPages: 2, maxDepth: 1 }, {
      httpClient: { fetchUrl: async (url) => html(url.toString(), `<html><main>Page ${url}</main><a href="https://example.com/a">A</a><a href="https://other.com/x">X</a></html>`) },
    });

    expect(result.crawlId).toBe("c1");
    expect(result.pages).toHaveLength(2);
    expect(result.visited).toContain("https://example.com/a");
    expect(result.statePath).toContain("c1");
  });

  it("processes discovered pages concurrently up to the global limit", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await runCrawl("https://example.com", { rootDir, crawlId: "global", maxPages: 5, maxDepth: 1, concurrency: 2 }, {
      httpClient: {
        fetchUrl: async (url) => {
          const value = url.toString();
          if (value === "https://example.com/") {
            return html(value, `<html><main>Seed</main><a href="https://example.com/a">A</a><a href="https://example.com/b">B</a><a href="https://example.com/c">C</a><a href="https://example.com/d">D</a></html>`);
          }
          active += 1;
          maxActive = Math.max(maxActive, active);
          await sleep(5);
          active -= 1;
          return html(value, `<html><main>${value}</main></html>`);
        },
      },
    });

    expect(result.pages).toHaveLength(5);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("respects per-host crawl concurrency while allowing other hosts", async () => {
    const activeByHost = new Map<string, number>();
    const maxByHost = new Map<string, number>();
    let maxGlobal = 0;
    const result = await runCrawl("https://example.com", { rootDir, crawlId: "per-host", maxPages: 5, maxDepth: 1, sameOrigin: false, concurrency: 4, perHostConcurrency: 1 }, {
      httpClient: {
        fetchUrl: async (url) => {
          const value = url.toString();
          if (value === "https://example.com/") {
            return html(value, `<html><main>Seed</main><a href="https://a.test/1">A1</a><a href="https://a.test/2">A2</a><a href="https://b.test/1">B1</a><a href="https://b.test/2">B2</a></html>`);
          }
          const host = new URL(value).host;
          activeByHost.set(host, (activeByHost.get(host) ?? 0) + 1);
          maxByHost.set(host, Math.max(maxByHost.get(host) ?? 0, activeByHost.get(host) ?? 0));
          maxGlobal = Math.max(maxGlobal, [...activeByHost.values()].reduce((sum, count) => sum + count, 0));
          await sleep(5);
          activeByHost.set(host, (activeByHost.get(host) ?? 1) - 1);
          return html(value, `<html><main>${value}</main></html>`);
        },
      },
    });

    expect(result.pages).toHaveLength(5);
    expect(maxGlobal).toBeGreaterThan(1);
    expect(maxByHost.get("a.test")).toBe(1);
    expect(maxByHost.get("b.test")).toBe(1);
  });

  it("resumes from saved frontier state", async () => {
    const first = await runCrawl("https://example.com", { rootDir, crawlId: "resume", maxPages: 1, maxDepth: 1 }, {
      httpClient: { fetchUrl: async (url) => html(url.toString(), `<html><main>Seed</main><a href="https://example.com/a">A</a></html>`) },
    });
    expect(first.pages).toHaveLength(1);
    expect((await loadCrawlState("resume", { rootDir })).frontier[0]?.url).toBe("https://example.com/a");

    const second = await runCrawl("https://example.com", { rootDir, crawlId: "resume", maxPages: 1, maxDepth: 1 }, {
      httpClient: { fetchUrl: async (url) => html(url.toString(), `<html><main>${url}</main></html>`) },
    });
    expect(second.pages[0]?.url).toBe("https://example.com/a");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
