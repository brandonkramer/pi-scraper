/**
 * @fileoverview summarize __tests__ page.test module.
 */
import { describe, expect, it } from "vitest";
import { summarizePage } from "../page.ts";
import type { ModelAdapter } from "../../extract/adhoc/model.ts";

const model: ModelAdapter = {
  run: async <T>(request: Parameters<ModelAdapter["run"]>[0]) => ({ data: "" as T, text: `${request.prompt} ${request.input.slice(0, 6)}` }),
};

describe("summarizePage", () => {
  it("keeps summarization page-scoped through an injected model", async () => {
    const result = await summarizePage({ content: "A long page about local-first scraping.", bullets: 2 }, model);
    expect(result.input.source).toBe("provided");
    expect(result.summary).toContain("2 bullets");
  });
});
