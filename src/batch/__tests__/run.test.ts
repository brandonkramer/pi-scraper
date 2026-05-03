import { describe, expect, it } from "vitest";
import { runBatchScrape } from "../run.js";
import type { FetchUrlResult } from "../../http/client.js";

function response(url: string, text: string): FetchUrlResult {
  return { url, finalUrl: url, status: 200, headers: { "content-type": "text/html" }, contentType: "text/html", text, downloadedBytes: text.length };
}

describe("runBatchScrape", () => {
  it("keeps input order and reports per-item failures", async () => {
    const result = await runBatchScrape(["https://a.test/", "https://b.test/"], {}, {
      httpClient: {
        fetchUrl: async (url) => {
          const value = url.toString();
          if (value.includes("b.test")) throw new Error("boom");
          return response(value, "<html><title>A</title><main>Hello world from A with enough content for extraction.</main></html>");
        },
      },
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.ok).toBe(true);
    expect(result.items[1]?.ok).toBe(false);
    expect(result.summary).toContain("1 succeeded, 1 failed");
  });

  it("dedupes normalized URLs while preserving ordered items", async () => {
    let fetches = 0;
    const result = await runBatchScrape(["https://a.test/?utm_source=x", "https://a.test/"], {}, {
      httpClient: {
        fetchUrl: async (url) => {
          fetches += 1;
          return response(url.toString(), "<html><main>Hello duplicate URL.</main></html>");
        },
      },
    });

    expect(fetches).toBe(1);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.ok)).toBe(true);
  });

  it("propagates aborts to in-flight scrape work instead of silently completing", async () => {
    const controller = new AbortController();
    const started = deferred<void>();
    const aborted = deferred<void>();
    const run = runBatchScrape(["https://a.test/", "https://b.test/"], { concurrency: 1 }, {
      httpClient: {
        fetchUrl: async (_url, _options, signal) => {
          started.resolve();
          signal?.addEventListener("abort", () => aborted.resolve(), { once: true });
          await aborted.promise;
          throw signal?.reason ?? new DOMException("Batch aborted", "AbortError");
        },
      },
    }, controller.signal);

    await started.promise;
    controller.abort(new DOMException("Batch aborted", "AbortError"));
    await expect(run).rejects.toThrow(/aborted/iu);
    await aborted.promise;
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
