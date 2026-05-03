import { describe, expect, it } from "vitest";
import type { SafeUrlResult } from "../../http/url-safety.js";
import {
	createPlaywrightRenderer,
	type PlaywrightModule,
} from "../playwright.js";

const URL = "http://93.184.216.34/page";

describe("createPlaywrightRenderer", () => {
	it("returns structured missing-browser errors from the lazy loader", async () => {
		const renderer = createPlaywrightRenderer({
			loader: async () => {
				throw new Error("not installed");
			},
		});

		await expect(renderer.fetchRendered(URL)).rejects.toMatchObject({
			name: "BrowserRenderError",
			structured: {
				code: "BROWSER_UNAVAILABLE",
				phase: "browser",
				retryable: false,
				url: URL,
			},
		});
	});

	it("blocks unsafe initial browser navigation URLs before loading Playwright", async () => {
		let loaded = false;
		const privateUrl = "http://127.0.0.1/admin";
		const renderer = createPlaywrightRenderer({
			loader: async () => {
				loaded = true;
				return fakePlaywright({});
			},
		});

		await expect(renderer.fetchRendered(privateUrl)).rejects.toMatchObject({
			name: "BrowserRenderError",
			structured: {
				code: "BROWSER_BLOCKED_PRIVATE_URL",
				phase: "browser",
				retryable: false,
				url: privateUrl,
				finalUrl: privateUrl,
			},
		});
		expect(loaded).toBe(false);
	});

	it("plumbs the intentionally narrow browser options into Playwright", async () => {
		const seen: Record<string, unknown> = {};
		const renderer = createPlaywrightRenderer({
			loader: async () => fakePlaywright(seen),
		});

		const result = await renderer.fetchRendered(URL, {
			timeoutSeconds: 7,
			waitUntil: "domcontentloaded",
			proxy: "http://proxy.example:8080",
			browserProfile: "pi-scraper-test-agent",
			headers: { "x-test": "yes" },
			cookies: { session: "abc" },
		});

		expect(result).toMatchObject({
			url: URL,
			finalUrl: `${URL}#rendered`,
			status: 204,
			html: "<html>rendered</html>",
		});
		expect(seen.launch).toMatchObject({
			headless: true,
			proxy: { server: "http://proxy.example:8080" },
		});
		expect(seen.context).toMatchObject({
			extraHTTPHeaders: { "x-test": "yes" },
			userAgent: "pi-scraper-test-agent",
		});
		expect(seen.cookies).toEqual([{ name: "session", value: "abc", url: URL }]);
		expect(seen.routeGlob).toBe("**/*");
		expect(seen.goto).toMatchObject({
			waitUntil: "domcontentloaded",
			timeout: 7_000,
		});
		expect(seen.continued).toEqual([URL]);
		expect(seen.closed).toBe(true);
	});

	it("blocks unsafe browser subresource requests before returning content", async () => {
		const seen: Record<string, unknown> = {};
		const privateUrl = "http://127.0.0.1/admin";
		const renderer = createPlaywrightRenderer({
			loader: async () =>
				fakePlaywright(seen, { requestUrls: [URL, privateUrl] }),
		});

		await expect(renderer.fetchRendered(URL)).rejects.toMatchObject({
			name: "BrowserRenderError",
			structured: {
				code: "BROWSER_BLOCKED_PRIVATE_URL",
				phase: "browser",
				retryable: false,
				url: URL,
				finalUrl: privateUrl,
			},
		});
		expect(seen.aborted).toEqual([
			{ url: privateUrl, errorCode: "blockedbyclient" },
		]);
		expect(seen.closed).toBe(true);
	});

	it("validates the final browser navigation URL", async () => {
		const privateUrl = "http://127.0.0.1/admin";
		const seen: Record<string, unknown> = {};
		const renderer = createPlaywrightRenderer({
			loader: async () => fakePlaywright(seen, { finalUrl: privateUrl }),
		});

		await expect(renderer.fetchRendered(URL)).rejects.toMatchObject({
			name: "BrowserRenderError",
			structured: {
				code: "BROWSER_BLOCKED_PRIVATE_URL",
				phase: "browser",
				retryable: false,
				url: URL,
				finalUrl: privateUrl,
			},
		});
		expect(seen.closed).toBe(true);
	});

	it("lets Chromium handle subresource DNS failures without poisoning the render", async () => {
		const seen: Record<string, unknown> = {};
		const flakyUrl = "https://flaky-subresource.invalid/script.js";
		const renderer = createPlaywrightRenderer({
			loader: async () =>
				fakePlaywright(seen, { requestUrls: [URL, flakyUrl] }),
			safetyCheck: async (input) => {
				const value = input.toString();
				if (value.includes("flaky-subresource.invalid")) {
					throw Object.assign(new Error("getaddrinfo ENOTFOUND"), {
						code: "ENOTFOUND",
					});
				}
				return safeResult(value);
			},
		});

		await expect(renderer.fetchRendered(URL)).resolves.toMatchObject({
			finalUrl: `${URL}#rendered`,
			html: "<html>rendered</html>",
		});
		expect(seen.continued).toEqual([URL, flakyUrl]);
		expect(seen.aborted).toBeUndefined();
		expect(seen.closed).toBe(true);
	});

	it("does not fail renders for benign non-network browser schemes", async () => {
		const seen: Record<string, unknown> = {};
		const routedUrls = [
			URL,
			"data:text/plain,hello",
			"blob:https://example.com/id",
			"about:blank",
			"chrome-extension://extension-id/script.js",
			"devtools://devtools/bundled/panel.html",
		];
		const renderer = createPlaywrightRenderer({
			loader: async () => fakePlaywright(seen, { requestUrls: routedUrls }),
		});

		await expect(renderer.fetchRendered(URL)).resolves.toMatchObject({
			status: 204,
		});
		expect(seen.continued).toEqual(routedUrls);
		expect(seen.aborted).toBeUndefined();
	});

	it("still blocks routed file URLs", async () => {
		const seen: Record<string, unknown> = {};
		const fileUrl = "file:///etc/passwd";
		const renderer = createPlaywrightRenderer({
			loader: async () => fakePlaywright(seen, { requestUrls: [URL, fileUrl] }),
		});

		await expect(renderer.fetchRendered(URL)).rejects.toMatchObject({
			name: "BrowserRenderError",
			structured: {
				code: "BROWSER_BLOCKED_PRIVATE_URL",
				phase: "browser",
				url: URL,
				finalUrl: fileUrl,
			},
		});
		expect(seen.aborted).toEqual([
			{ url: fileUrl, errorCode: "blockedbyclient" },
		]);
	});

	it("dedupes hostname safety checks within a render", async () => {
		const seen: Record<string, unknown> = {};
		const checks = new Map<string, number>();
		const otherHost = "https://example.com/asset.js";
		const renderer = createPlaywrightRenderer({
			loader: async () =>
				fakePlaywright(seen, {
					requestUrls: [URL, `${URL}?asset=1`, otherHost, `${otherHost}?v=2`],
				}),
			safetyCheck: async (input) => {
				const value = input.toString();
				const hostname = new globalThis.URL(value).hostname;
				checks.set(hostname, (checks.get(hostname) ?? 0) + 1);
				return safeResult(value);
			},
		});

		await expect(renderer.fetchRendered(URL)).resolves.toMatchObject({
			finalUrl: `${URL}#rendered`,
		});
		expect(Object.fromEntries(checks)).toEqual({
			"93.184.216.34": 1,
			"example.com": 1,
		});
	});
});

interface FakePlaywrightOptions {
	finalUrl?: string;
	requestUrls?: string[];
}

interface FakeRoute {
	abort(errorCode?: string): Promise<void>;
	continue(): Promise<void>;
	request(): { url(): string };
}

function safeResult(value: string): SafeUrlResult {
	return {
		url: new globalThis.URL(value),
		normalizedUrl: value,
		checkedAddresses: [],
	};
}

function fakePlaywright(
	seen: Record<string, unknown>,
	options: FakePlaywrightOptions = {},
): PlaywrightModule {
	let routeHandler: ((route: FakeRoute) => Promise<void>) | undefined;
	return {
		chromium: {
			launch: async (launchOptions) => {
				seen.launch = launchOptions;
				return {
					newContext: async (contextOptions) => {
						seen.context = contextOptions;
						return {
							addCookies: async (cookies) => {
								seen.cookies = cookies;
							},
							route: async (glob, handler) => {
								seen.routeGlob = glob;
								routeHandler = handler;
							},
							newPage: async () => ({
								goto: async (requestUrl, gotoOptions) => {
									seen.goto = gotoOptions;
									for (const url of options.requestUrls ?? [requestUrl]) {
										await routeHandler?.(fakeRoute(seen, url));
									}
									return { status: () => 204 };
								},
								content: async () => "<html>rendered</html>",
								url: () => options.finalUrl ?? `${URL}#rendered`,
								close: async () => undefined,
							}),
						};
					},
					close: async () => {
						seen.closed = true;
					},
				};
			},
		},
	};
}

function fakeRoute(seen: Record<string, unknown>, url: string): FakeRoute {
	return {
		abort: async (errorCode) => {
			const aborted =
				(seen.aborted as
					| Array<Record<string, string | undefined>>
					| undefined) ?? [];
			aborted.push({ url, errorCode });
			seen.aborted = aborted;
		},
		continue: async () => {
			const continued = (seen.continued as string[] | undefined) ?? [];
			continued.push(url);
			seen.continued = continued;
		},
		request: () => ({ url: () => url }),
	};
}
