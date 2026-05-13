/* @fileoverview Meta-refresh redirect tests. */
import { describe, expect, it, vi } from "vitest";

import type { FetchUrlResult } from "../../http/client.ts";
import { type ScrapePipelineDeps, scrapeUrl } from "../pipeline.ts";

const URL = "https://example.com/shell";
const TARGET = "https://example.com/target";
const CROSS_ORIGIN = "https://other.example.com/target";

describe("meta-refresh redirect", () => {
	it("follows a meta-refresh redirect when primary content is thin", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/target">`)),
			[TARGET]: htmlResponse(richHtml("", "Rich target content.")),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL, TARGET]);
		expect(result.url).toBe(URL);
		expect(result.finalUrl).toBe(URL);
		expect(result.data.markdown).toContain("Rich target content");
		expect(result.fetchedVia).toMatchObject({
			kind: "meta-refresh",
			url: TARGET,
			chain: [URL],
		});
	});

	it("keeps rich primary content even when a meta-refresh is present", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(richHtml(`<meta http-equiv="refresh" content="0; url=/target">`)),
			[TARGET]: htmlResponse(richHtml("", "Target content.")),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL]);
		expect(result.data.markdown).toContain("Rich primary content");
		expect(result.fetchedVia).toBeUndefined();
	});

	it("does not follow when delay exceeds 5 seconds", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="30; url=/target">`)),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL]);
		expect(result.fetchedVia).toBeUndefined();
	});

	it("does not loop when meta-refresh points at the current URL", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/shell">`)),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL]);
		expect(result.fetchedVia).toBeUndefined();
	});

	it("stops after 3 hops and returns the last content with a diagnostic", async () => {
		const hop1 = "https://example.com/hop1";
		const hop2 = "https://example.com/hop2";
		const hop3 = "https://example.com/hop3";
		const hop4 = "https://example.com/hop4";
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/hop1">`), URL),
			[hop1]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/hop2">`), hop1),
			[hop2]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/hop3">`), hop2),
			[hop3]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/hop4">`), hop3),
			[hop4]: htmlResponse(richHtml("", "Hop four content."), hop4),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL, hop1, hop2, hop3]);
		expect(result.url).toBe(URL);
		expect(result.fetchedVia).toMatchObject({
			kind: "meta-refresh",
			chain: [URL, hop1, hop2],
		});
		expect(result.diagnostics?.metaRefreshHops).toBe(3);
	});

	it("follows cross-origin meta-refresh (SSRF still applies)", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=${CROSS_ORIGIN}">`)),
			[CROSS_ORIGIN]: htmlResponse(richHtml("", "Cross-origin content.")),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL, CROSS_ORIGIN]);
		expect(result.data.markdown).toContain("Cross-origin content");
	});

	it("falls back to original content when the target fetch is blocked", async () => {
		const harness = depsFor((url) => {
			if (url === TARGET) throw new Error("SSRF blocked");
			return htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/target">`));
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL, TARGET]);
		expect(result.error).toBeUndefined();
		expect(result.data.route).toBe("html");
		expect(result.diagnostics?.metaRefreshFallback).toMatchObject({
			url: TARGET,
		});
	});

	it("falls back to original when meta-refresh target is robots-disallowed", async () => {
		const harness = depsFor((url) => {
			if (url === TARGET)
				throw Object.assign(new Error("Blocked by robots.txt"), {
					structured: { code: "ROBOTS_BLOCKED", phase: "robots", retryable: false },
				});
			return htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/target">`));
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL, TARGET]);
		expect(result.error).toBeUndefined();
		expect(result.data.route).toBe("html");
		expect(result.diagnostics?.metaRefreshFallback).toMatchObject({
			url: TARGET,
			error: expect.objectContaining({
				code: "SCRAPE_FAILED",
				cause: expect.objectContaining({
					structured: expect.objectContaining({ code: "ROBOTS_BLOCKED" }),
				}),
			}),
		});
	});

	it("ignores meta-refresh when followMetaRefresh is false", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="0; url=/target">`)),
			[TARGET]: htmlResponse(richHtml("", "Target content.")),
		});

		const result = await scrapeUrl(
			URL,
			{ mode: "fast", format: "markdown", followMetaRefresh: false },
			harness.deps,
		);

		expect(harness.calls()).toEqual([URL]);
		expect(result.data.route).toBe("html");
		expect(result.fetchedVia).toBeUndefined();
	});

	it("does not crash on malformed meta-refresh content", async () => {
		const harness = depsFor({
			[URL]: htmlResponse(thinHtml(`<meta http-equiv="refresh" content="abc; not-a-url">`)),
		});

		const result = await scrapeUrl(URL, { mode: "fast", format: "markdown" }, harness.deps);

		expect(harness.calls()).toEqual([URL]);
		expect(result.data.route).toBe("html");
		expect(result.fetchedVia).toBeUndefined();
	});
});

function depsFor(responses: Record<string, FetchUrlResult> | ((url: string) => FetchUrlResult)): {
	calls: () => string[];
	deps: ScrapePipelineDeps;
} {
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

function htmlResponse(html: string, url = URL): FetchUrlResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		headers: { "content-type": "text/html" },
		contentType: "text/html",
		text: html,
		body: Buffer.from(html),
		downloadedBytes: Buffer.byteLength(html),
	};
}

function thinHtml(head: string): string {
	return `<html><head>${head}</head><body><main><p>Thin shell.</p></main></body></html>`;
}

function richHtml(head: string, bodyText = "Rich primary content."): string {
	return `<html><head>${head}</head><body><main><h1>${bodyText}</h1><p>${"Enough useful original content. ".repeat(12)}</p></main></body></html>`;
}
