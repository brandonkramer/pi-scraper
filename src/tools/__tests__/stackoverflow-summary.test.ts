/** @file Live Stack Overflow vertical summary smoke (network). */
import { describe, expect, it } from "vitest";

import { webExtractTool } from "../web-extract.ts";

const liveEnabled = process.env.PI_SCRAPER_LIVE === "1";

describe.skipIf(!liveEnabled)("live stackoverflow summary", () => {
	it("includes answer count in collapsed vertical summary", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "vertical",
				extractor: "stackoverflow",
				url: "https://stackoverflow.com/questions/11227809/why-is-conditional-processing-of-a-sorted-array-faster-than-of-an-unsorted-array",
			},
			AbortSignal.timeout(60_000),
		);
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("answers");
		expect(text).not.toMatch(/\bvideo\b/iu);
	}, 90_000);
});
