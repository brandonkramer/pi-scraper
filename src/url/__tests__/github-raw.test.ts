/** @file URL **tests** github-raw.test module. */
import { describe, expect, it } from "vitest";

import { normalizeGitHubBlobUrl } from "../github-raw.ts";

describe("normalizeGitHubBlobUrl", () => {
	it("converts a GitHub blob URL to raw", () => {
		const result = normalizeGitHubBlobUrl(
			"https://github.com/earendil-works/pi-scraper/blob/main/src/index.ts",
		);
		expect(result).toEqual({
			originalUrl: "https://github.com/earendil-works/pi-scraper/blob/main/src/index.ts",
			rawUrl: "https://raw.githubusercontent.com/earendil-works/pi-scraper/main/src/index.ts",
		});
	});

	it("returns undefined for a tree URL", () => {
		expect(
			normalizeGitHubBlobUrl("https://github.com/earendil-works/pi-scraper/tree/main/src"),
		).toBeUndefined();
	});

	it("returns undefined for an issue URL", () => {
		expect(
			normalizeGitHubBlobUrl("https://github.com/earendil-works/pi-scraper/issues/1"),
		).toBeUndefined();
	});

	it("returns undefined for non-GitHub hosts", () => {
		expect(normalizeGitHubBlobUrl("https://gitlab.com/org/repo/blob/main/file.ts")).toBeUndefined();
	});

	it("returns undefined for invalid URLs", () => {
		expect(normalizeGitHubBlobUrl("not-a-url")).toBeUndefined();
	});
});
