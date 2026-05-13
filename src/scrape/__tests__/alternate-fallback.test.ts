/* @fileoverview Scrape alternate content-format fallback tests. */
import { describe, expect, it, vi } from "vitest";

import type { FetchUrlResult } from "../../http/client.ts";
import { type ScrapePipelineDeps, scrapeUrl } from "../pipeline.ts";

const URL = "https://example.com/post";
const ALT_URL = "https://example.com/post.md";

interface FetchHarness {
	deps: ScrapePipelineDeps;
	calls: () => string[];
}

describe("alternate content fallback", () => {
	it("follows a same-origin markdown alternate when primary content is thin", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<link rel="alternate" type="text/markdown" href="/post.md">`)),
			[ALT_URL]: textResponse(ALT_URL, "text/markdown", "# Alternate\n\nUseful markdown body."),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL, ALT_URL]);
		expect(result.url).toBe(URL);
		expect(result.finalUrl).toBe(URL);
		expect(result.data.route).toBe("markdown");
		expect(result.data.markdown).toContain("Useful markdown body");
		expect(result.fetchedVia).toMatchObject({
			kind: "alternate",
			url: ALT_URL,
			type: "text/markdown",
		});
	});

	it("keeps rich primary content even when an alternate is advertised", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(richHtml(`<link rel="alternate" type="text/markdown" href="/post.md">`)),
			[ALT_URL]: textResponse(ALT_URL, "text/markdown", "# Alternate"),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL]);
		expect(result.data.route).toBe("html");
		expect(result.data.markdown).toContain("Rich primary content");
		expect(result.fetchedVia).toBeUndefined();
	});

	it("does not follow cross-origin alternates", async () => {
		const other = "https://cdn.example.net/post.md";
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<link rel="alternate" type="text/markdown" href="${other}">`)),
			[other]: textResponse(other, "text/markdown", "# Cross origin"),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL]);
		expect(result.data.route).toBe("html");
		expect(result.fetchedVia).toBeUndefined();
	});

	it("does not loop when an alternate points at the current URL", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<link rel="alternate" type="text/markdown" href="/post">`)),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL]);
		expect(result.data.route).toBe("html");
		expect(result.fetchedVia).toBeUndefined();
	});

	it("does not recurse when already fetching an alternate", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<link rel="alternate" type="text/markdown" href="/post.md">`)),
			[ALT_URL]: textResponse(ALT_URL, "text/markdown", "# Alternate"),
		});

		const result = await scrapeUrl(
			URL,
			{ mode: "fast", format: "markdown", alternateFor: "https://example.com/original" },
			harness.deps,
		);

		expect(harness.calls()).toEqual([URL]);
		expect(result.data.route).toBe("html");
		expect(result.fetchedVia).toBeUndefined();
	});

	it("falls back to original content when the alternate fetch is blocked", async () => {
		const harness = blockedAlternateDeps();

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL, ALT_URL]);
		expect(result.error).toBeUndefined();
		expect(result.data.route).toBe("html");
		expect(result.data.markdown).toContain("Thin shell");
		expect(result.diagnostics?.alternateFallback).toMatchObject({ url: ALT_URL });
	});

	it("ignores alternates when followAlternates is false", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<link rel="alternate" type="text/markdown" href="/post.md">`)),
			[ALT_URL]: textResponse(ALT_URL, "text/markdown", "# Alternate"),
		});

		const result = await scrapeUrl(
			URL,
			{ mode: "fast", format: "markdown", followAlternates: false },
			harness.deps,
		);

		expect(harness.calls()).toEqual([URL]);
		expect(result.data.route).toBe("html");
		expect(result.fetchedVia).toBeUndefined();
	});
});

function blockedAlternateDeps(): FetchHarness {
	return depsFor((url) => {
		if (url === ALT_URL) throw new Error("SSRF blocked");
		return htmlResponse(thinHtml(`<link rel="alternate" type="text/markdown" href="/post.md">`));
	});
}

function depsFor(
	responses: Record<string, FetchUrlResult> | ((url: string) => FetchUrlResult),
): FetchHarness {
	const calls: string[] = [];
	return {
		calls: () => calls,
		deps: {
			httpClient: {
				fetchUrl: vi.fn(async (input: string | URL) => {
					const url = input.toString();
					calls.push(url);
					if (typeof responses === "function") return responses(url);
					const response = responses[url];
					if (!response) throw new Error(`Unexpected fetch: ${url}`);
					return response;
				}),
			},
		},
	};
}

function htmlResponse(html: string): FetchUrlResult {
	return {
		...baseResponse(URL, "text/html"),
		text: html,
		body: Buffer.from(html),
		downloadedBytes: Buffer.byteLength(html),
	};
}

function textResponse(url: string, contentType: string, text: string): FetchUrlResult {
	return {
		...baseResponse(url, contentType),
		text,
		body: Buffer.from(text),
		downloadedBytes: Buffer.byteLength(text),
	};
}

function baseResponse(url: string, contentType: string): FetchUrlResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		headers: { "content-type": contentType },
		contentType,
		downloadedBytes: 0,
	};
}

function thinHtml(head: string): string {
	return `<html><head>${head}</head><body><main><p>Thin shell.</p></main></body></html>`;
}

function richHtml(head: string): string {
	return `<html><head>${head}</head><body><main><h1>Rich primary content</h1><p>${"Enough useful original content. ".repeat(12)}</p></main></body></html>`;
}
