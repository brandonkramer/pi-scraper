import { describe, expect, it } from "vitest";
import { listExtractorCapabilities } from "../../extract/registry.js";
import { extractorNames } from "../web-vertical-scrape.js";

describe("web_vertical_scrape schema", () => {
	it("keeps the public extractor enum in sync with registered capabilities", () => {
		expect([...extractorNames]).toEqual(
			listExtractorCapabilities().map((capability) => capability.name),
		);
	});
});
