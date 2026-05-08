/**
 * @fileoverview url __tests__ normalize.test module.
 */
import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../normalize.js";

describe("normalizeUrl", () => {
  it("normalizes host, ports, tracking params, query order, fragments, and trailing slash", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a/?utm_source=x&b=2&a=1#frag")).toBe(
      "https://example.com/a?a=1&b=2",
    );
  });
});
