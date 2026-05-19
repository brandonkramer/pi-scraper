/** @file Summarize **tests** page.test module. */
import { describe, expect, it } from "vitest";

import type { ModelAdapter, ModelResponse } from "../extract/adhoc/model.ts";
import { summarizePage } from "../summarize.ts";

const model: ModelAdapter = {
	run: async <T>(request: Parameters<ModelAdapter["run"]>[0]): Promise<ModelResponse<T>> => ({
		data: "" as T,
		text: `${request.prompt ?? ""} ${request.input.slice(0, 6)}`,
	}),
};

describe("summarizePage", () => {
	it("keeps summarization page-scoped through an injected model", async () => {
		const result = await summarizePage(
			{ content: "A long page about local-first scraping.", bullets: 2 },
			model,
		);
		expect(result.input.source).toBe("provided");
		expect(result.summary).toContain("2 bullets");
	});
});
