/**
 * @fileoverview http __tests__ robots.test module.
 */
import { describe, expect, it } from "vitest";
import { RobotsCache } from "../robots.ts";

describe("RobotsCache", () => {
  it("does not cache aborted robots fetches", async () => {
    let calls = 0;
    const cache = new RobotsCache({
      fetchText: async () => {
        calls += 1;
        if (calls === 1) {
          throw new DOMException("cancelled", "AbortError");
        }
        return { status: 200, text: "User-agent: *\nDisallow: /blocked" };
      },
    });

    await expect(cache.rulesFor("https://example.com/allowed")).rejects.toThrow("cancelled");
    const rules = await cache.rulesFor("https://example.com/blocked");

    expect(calls).toBe(2);
    expect(rules.isAllowed("https://example.com/blocked")).toBe(false);
  });

  it("does not permanently cache fallback rules from failed robots fetches", async () => {
    let calls = 0;
    const cache = new RobotsCache({
      fetchText: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("network failed");
        }
        return { status: 200, text: "User-agent: *\nDisallow: /blocked" };
      },
    });

    const fallback = await cache.rulesFor("https://example.com/blocked");
    const retried = await cache.rulesFor("https://example.com/blocked");

    expect(calls).toBe(2);
    expect(fallback.isAllowed("https://example.com/blocked")).toBe(true);
    expect(retried.isAllowed("https://example.com/blocked")).toBe(false);
  });

  it("treats 5xx robots responses as temporary fail-closed rules", async () => {
    let calls = 0;
    const cache = new RobotsCache({
      fetchText: async () => {
        calls += 1;
        if (calls === 1) {
          return { status: 503, text: "temporarily unavailable" };
        }
        return { status: 200, text: "User-agent: *\nAllow: /recovered" };
      },
    });

    const temporaryFailure = await cache.rulesFor("https://example.com/recovered");
    const recovered = await cache.rulesFor("https://example.com/recovered");

    expect(calls).toBe(2);
    expect(temporaryFailure.isAllowed("https://example.com/recovered")).toBe(false);
    expect(recovered.isAllowed("https://example.com/recovered")).toBe(true);
  });
});
