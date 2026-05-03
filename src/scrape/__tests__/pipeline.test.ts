import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	BrowserRenderError,
	type BrowserRenderer,
} from "../../browser/playwright.js";
import type { FetchUrlResult } from "../../http/client.js";
import type { FingerprintFetchAdapter } from "../../http/fingerprint.js";
import { scrapeUrl, type ScrapePipelineDeps } from "../pipeline.js";

const URL = "https://example.com/page";
const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const pdfFixture = path.join(rootDir, "eval/fixtures/pdf-document.pdf");

describe("scrapeUrl", () => {
	it("scrapes static HTML without browser escalation", async () => {
		const browser = fakeBrowser();
		const result = await scrapeUrl(
			URL,
			{ mode: "auto" },
			deps(htmlResponse(articleHtml()), { browserRenderer: browser.renderer }),
		);

		expect(result.mode).toBe("fast");
		expect(result.data.title).toBe("Static Article");
		expect(result.data.markdown).toContain("Hello static world");
		expect(browser.calls()).toBe(0);
	});

	it("escalates to readable when readable extraction is better", async () => {
		const readableText = "Readable article text ".repeat(40);
		const result = await scrapeUrl(
			URL,
			{ mode: "auto" },
			deps(
				htmlResponse("<html><body><h1>Short</h1><p>Thin.</p></body></html>"),
				{
					readableExtractor: () => ({
						ok: true,
						title: "Readable",
						textContent: readableText,
						contentHtml: `<article><p>${readableText}</p></article>`,
					}),
				},
			),
		);

		expect(result.mode).toBe("readable");
		expect(result.data.extractionPath).toEqual(["fast", "readable"]);
		expect(result.data.text).toContain("Readable article text");
	});

	it("recovers useful sparse content from data islands without browser", async () => {
		const browser = fakeBrowser();
		const html = `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"title":"Island Title","description":"Recovered data island sentence with enough useful words to keep."}}}</script></body></html>`;
		const result = await scrapeUrl(
			URL,
			{ mode: "auto" },
			deps(htmlResponse(html), { browserRenderer: browser.renderer }),
		);

		expect(result.data.text).toContain("Island Title");
		expect(result.data.signals?.reasons).toContain("rich_data_islands");
		expect(browser.calls()).toBe(0);
	});

	it("routes PDFs through the PDF extraction boundary", async () => {
		const result = await scrapeUrl(
			`${URL}.pdf`,
			{ mode: "fast" },
			deps({
				...baseResponse(`${URL}.pdf`, "application/pdf"),
				body: Buffer.from("%PDF"),
				downloadedBytes: 4,
			}),
		);

		expect(result.data.route).toBe("pdf");
		expect(result.data.pdf).toMatchObject({ ok: false });
	});

	it("materializes extracted PDF text through scrape output formats", async () => {
		const body = await readFile(pdfFixture);
		const result = await scrapeUrl(
			`${URL}.pdf`,
			{ mode: "fast", format: "markdown" },
			deps({
				...baseResponse(`${URL}.pdf`, "application/pdf"),
				body,
				downloadedBytes: body.byteLength,
			}),
		);

		expect(result.data.route).toBe("pdf");
		expect(result.data.pdf).toMatchObject({ ok: true, pageCount: 1 });
		expect(result.data.markdown).toContain("Synthetic PDF");
		expect(result.data.text).toContain("Synthetic PDF");
	});

	it("returns binary attachment metadata for non-text media", async () => {
		const result = await scrapeUrl(
			`${URL}.png`,
			{ mode: "fast" },
			deps({
				...baseResponse(`${URL}.png`, "image/png"),
				file: {
					path: "/tmp/image.bin",
					contentType: "image/png",
					downloadedBytes: 12,
				},
				downloadedBytes: 12,
			}),
		);

		expect(result.data.route).toBe("binary");
		expect(result.data.file).toMatchObject({
			path: "/tmp/image.bin",
			kind: "binary",
		});
	});

	it("returns structured blocked signals without anti-bot promises", async () => {
		const blocked = htmlResponse(
			`<html><body><h1>Access denied</h1><p>${"captcha blocked text ".repeat(80)}</p></body></html>`,
			403,
		);
		const fingerprint: FingerprintFetchAdapter = {
			fetch: vi.fn(async () => blocked),
		};
		const result = await scrapeUrl(
			URL,
			{ mode: "auto" },
			deps(blocked, { fingerprintAdapter: fingerprint }),
		);

		expect(result.mode).toBe("fingerprint");
		expect(result.data.blocked).toBe(true);
		expect(result.data.signals?.blockedLikely).toBe(true);
	});

	it("marks failed auto browser attempts distinctly from successful browser renders", async () => {
		const blocked = htmlResponse(
			"<html><body><h1>Access denied</h1><p>captcha</p></body></html>",
			403,
		);
		const fingerprint: FingerprintFetchAdapter = {
			fetch: vi.fn(async () => {
				throw new Error("fingerprint unavailable");
			}),
		};
		const renderer: BrowserRenderer = {
			fetchRendered: vi.fn(async () => {
				throw new BrowserRenderError({
					code: "BROWSER_UNAVAILABLE",
					phase: "browser",
					message: "missing",
					retryable: false,
					url: URL,
				});
			}),
		};
		const result = await scrapeUrl(
			URL,
			{ mode: "auto" },
			deps(blocked, {
				fingerprintAdapter: fingerprint,
				browserRenderer: renderer,
			}),
		);

		expect(result.error?.code).toBe("BROWSER_UNAVAILABLE");
		expect(result.data.extractionPath).toEqual(["fast", "browser_failed"]);
	});

	it("returns browser unavailable errors when browser mode is requested", async () => {
		const renderer: BrowserRenderer = {
			fetchRendered: vi.fn(async () => {
				throw new BrowserRenderError({
					code: "BROWSER_UNAVAILABLE",
					phase: "browser",
					message: "missing",
					retryable: false,
					url: URL,
				});
			}),
		};
		const result = await scrapeUrl(
			URL,
			{ mode: "browser" },
			{ browserRenderer: renderer },
		);

		expect(result.error?.code).toBe("BROWSER_UNAVAILABLE");
		expect(result.mode).toBe("browser");
	});
});

function deps(
	response: FetchUrlResult,
	extra: Partial<ScrapePipelineDeps> = {},
): ScrapePipelineDeps {
	return { httpClient: { fetchUrl: vi.fn(async () => response) }, ...extra };
}

function htmlResponse(html: string, status = 200): FetchUrlResult {
	return {
		...baseResponse(URL, "text/html", status),
		text: html,
		body: Buffer.from(html),
		downloadedBytes: Buffer.byteLength(html),
	};
}

function baseResponse(
	url: string,
	contentType: string,
	status = 200,
): FetchUrlResult {
	return {
		url,
		finalUrl: url,
		status,
		headers: { "content-type": contentType },
		contentType,
		downloadedBytes: 0,
	};
}

function articleHtml(): string {
	return `<html><head><title>Static Article</title></head><body><main><h1>Static Article</h1><p>Hello static world.</p><p>${"More useful content. ".repeat(20)}</p></main></body></html>`;
}

function fakeBrowser(): { renderer: BrowserRenderer; calls: () => number } {
	let count = 0;
	return {
		calls: () => count,
		renderer: {
			fetchRendered: vi.fn(async () => {
				count += 1;
				return { url: URL, finalUrl: URL, status: 200, html: articleHtml() };
			}),
		},
	};
}
