import { describe, expect, it } from "vitest";
import type { ResultEnvelope } from "../../types.js";
import { webExtractTool } from "../web-extract.js";
import { webListExtractorsTool } from "../web-list-extractors.js";

const signal = new AbortController().signal;

describe("selected web tool handlers", () => {
	it("lists vertical extractor capabilities", async () => {
		const result = await webListExtractorsTool.execute("call", {}, signal);
		expect(result.content[0]?.text).toContain("extractor");
		expect(Array.isArray((result.details as ResultEnvelope).data)).toBe(true);
	});

	it("returns structured missing-model errors for ad hoc extraction", async () => {
		const result = await webExtractTool.execute(
			"call",
			{ url: "https://example.com" },
			signal,
		);
		expect((result.details as ResultEnvelope).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
		expect(result.content[0]?.text).toContain("model-backed");
	});

	it("renders compact calls and expanded results", async () => {
		const result = await webListExtractorsTool.execute("call", {}, signal);
		expect(webListExtractorsTool.renderCall?.({}, undefined)).toBe(
			"web_list_extractors",
		);
		expect(
			webListExtractorsTool.renderResult?.(
				result,
				{ expanded: true },
				undefined,
			),
		).toContain("extractor");
	});
});
