/** @file Map **tests** discover.test module. */
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { FetchUrlResult } from "../../http/client.ts";
import { discoverSiteUrls } from "../discover.ts";

function textResult(url: string, text: string): FetchUrlResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		headers: {},
		contentType: "text/plain",
		text,
		downloadedBytes: text.length,
	};
}

function binaryResult(url: string, body: Buffer): FetchUrlResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		headers: {},
		contentType: "application/gzip",
		body,
		text: body.toString("utf8"),
		downloadedBytes: body.byteLength,
	};
}

describe("discoverSiteUrls", () => {
	it("discovers URLs from robots sitemaps, nested sitemaps, and llms.txt without page content", async () => {
		const calls: string[] = [];
		const bodies = new Map<string, string>([
			["https://example.com/robots.txt", "Sitemap: https://example.com/sitemap-index.xml"],
			["https://example.com/sitemap.xml", ""],
			[
				"https://example.com/sitemap-index.xml",
				"<sitemapindex><sitemap><loc>https://example.com/posts.xml</loc></sitemap></sitemapindex>",
			],
			[
				"https://example.com/posts.xml",
				"<urlset><url><loc>https://example.com/post-a</loc><lastmod>2026-01-01</lastmod></url></urlset>",
			],
			["https://example.com/llms.txt", "# Docs\n[Guide](https://example.com/guide?utm_source=x)"],
		]);

		const result = await discoverSiteUrls(
			"https://example.com",
			{},
			{
				httpClient: textClientFor(calls, bodies),
			},
		);

		expect(result.urls.map((entry) => entry.url)).toEqual([
			"https://example.com/guide",
			"https://example.com/post-a",
		]);
		expect(result.urls.find((entry) => entry.url.endsWith("post-a"))?.lastmod).toBe("2026-01-01");
		expect(calls.some((url) => url.includes("post-a"))).toBe(false);
	});

	it("discovers URLs from raw gzipped sitemap bodies", async () => {
		const gzipped = gzipSync(
			"<urlset><url><loc>https://example.com/gz-page?utm_source=x</loc><lastmod>2026-02-01</lastmod></url></urlset>",
		);
		const bodies = new Map<string, FetchUrlResult>([
			[
				"https://example.com/robots.txt",
				textResult("https://example.com/robots.txt", "Sitemap: https://example.com/sitemap.xml.gz"),
			],
			["https://example.com/sitemap.xml", textResult("https://example.com/sitemap.xml", "")],
			[
				"https://example.com/sitemap.xml.gz",
				binaryResult("https://example.com/sitemap.xml.gz", gzipped),
			],
			["https://example.com/llms.txt", textResult("https://example.com/llms.txt", "")],
		]);

		const result = await discoverSiteUrls(
			"https://example.com",
			{},
			{
				httpClient: resultClientFor(bodies),
			},
		);

		expect(result.urls).toContainEqual({
			url: "https://example.com/gz-page",
			source: "sitemap",
			sourceUrl: "https://example.com/sitemap.xml.gz",
			lastmod: "2026-02-01",
		});
	});
});

function textClientFor(
	calls: string[],
	bodies: Map<string, string>,
): {
	fetchUrl: (url: URL) => Promise<FetchUrlResult>;
} {
	return {
		fetchUrl: async (url) => {
			const key = url.toString();
			calls.push(key);
			return textResult(key, bodies.get(key) ?? "");
		},
	};
}

function resultClientFor(bodies: Map<string, FetchUrlResult>): {
	fetchUrl: (url: URL) => Promise<FetchUrlResult>;
} {
	return {
		fetchUrl: async (url) => {
			const key = url.toString();
			return bodies.get(key) ?? textResult(key, "");
		},
	};
}
