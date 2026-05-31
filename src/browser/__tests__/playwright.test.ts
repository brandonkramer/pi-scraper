/** @file Browser **tests** playwright.test module. */
import { describe, expect, it } from "vitest";

import type { SafeUrlResult } from "../../http/url-safety.ts";
import {
	createPlaywrightRenderer,
	type BrowserBackend,
	type Browser,
	type BrowserRenderOptions,
	type BrowserRenderer,
} from "../playwright.ts";

const URL = "http://93.184.216.34/page";

async function flakySafetyCheck(input: string | URL): Promise<SafeUrlResult> {
	const value = input.toString();
	if (value.includes("flaky-subresource.invalid")) {
		throw Object.assign(new Error("getaddrinfo ENOTFOUND"), {
			code: "ENOTFOUND",
		});
	}
	return safeResult(value);
}

async function countingSafetyCheck(
	input: string | URL,
	checks: Map<string, number>,
): Promise<SafeUrlResult> {
	const value = input.toString();
	const hostname = new globalThis.URL(value).hostname;
	checks.set(hostname, (checks.get(hostname) ?? 0) + 1);
	return safeResult(value);
}

describe("createPlaywrightRenderer", () => {
	it("blocks unsafe initial browser navigation URLs before launching browser", async () => {
		let launched = false;
		const privateUrl = "http://127.0.0.1/admin";
		const renderer = createPlaywrightRenderer({
			browserLoader: async (backend, opts) => {
				launched = true;
				return fakeBrowser(backend, opts, seen);
			},
		});
		const seen: Record<string, unknown> = {};

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
		expect(launched).toBe(false);
	});

	it("plumbs browser options into launch and context", async () => {
		const seen: Record<string, unknown> = {};
		const renderer = makeTestRenderer(seen);

		const result = await renderer.fetchRendered(URL, {
			timeoutSeconds: 7,
			waitUntil: "domcontentloaded",
			proxy: "http://proxy.example:8080",
			headers: { "x-test": "yes" },
			cookies: { session: "abc" },
		});

		expect(result).toMatchObject({
			url: URL,
			finalUrl: `${URL}#rendered`,
			status: 204,
			html: "<html>rendered</html>",
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

	it("blocks unsafe browser subresource requests", async () => {
		const seen: Record<string, unknown> = {};
		const privateUrl = "http://127.0.0.1/admin";
		const renderer = makeTestRenderer(seen, { requestUrls: [URL, privateUrl] });

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
		expect(seen.aborted).toEqual([{ url: privateUrl, errorCode: "blockedbyclient" }]);
		expect(seen.closed).toBe(true);
	});

	it("validates the final browser navigation URL", async () => {
		const seen: Record<string, unknown> = {};
		const privateUrl = "http://127.0.0.1/admin";
		const renderer = makeTestRenderer(seen, { finalUrl: privateUrl });

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

	it("lets browser handle subresource DNS failures without poisoning the render", async () => {
		const seen: Record<string, unknown> = {};
		const flakyUrl = "https://flaky-subresource.invalid/script.js";
		const renderer = createPlaywrightRenderer({
			browserLoader: (backend, opts) =>
				Promise.resolve(fakeBrowser(backend, opts, seen, { requestUrls: [URL, flakyUrl] })),
			safetyCheck: flakySafetyCheck,
		});

		await expect(renderer.fetchRendered(URL)).resolves.toMatchObject({
			finalUrl: `${URL}#rendered`,
			html: "<html>rendered</html>",
		});
		expect(seen.continued).toEqual([URL, flakyUrl]);
		expect(seen.aborted).toBeUndefined();
		expect(seen.closed).toBe(true);
	});

	it("passes benign non-network browser schemes through", async () => {
		const seen: Record<string, unknown> = {};
		const routedUrls = [
			URL,
			"data:text/plain,hello",
			"blob:https://example.com/id",
			"about:blank",
			"chrome-extension://extension-id/script.js",
			"devtools://devtools/bundled/panel.html",
		];
		const renderer = makeTestRenderer(seen, { requestUrls: routedUrls });

		await expect(renderer.fetchRendered(URL)).resolves.toMatchObject({
			status: 204,
		});
		expect(seen.continued).toEqual(routedUrls);
		expect(seen.aborted).toBeUndefined();
	});

	it("blocks routed file URLs", async () => {
		const seen: Record<string, unknown> = {};
		const fileUrl = "file:///etc/passwd";
		const renderer = makeTestRenderer(seen, { requestUrls: [URL, fileUrl] });

		await expect(renderer.fetchRendered(URL)).rejects.toMatchObject({
			name: "BrowserRenderError",
			structured: {
				code: "BROWSER_BLOCKED_PRIVATE_URL",
				phase: "browser",
				url: URL,
				finalUrl: fileUrl,
			},
		});
		expect(seen.aborted).toEqual([{ url: fileUrl, errorCode: "blockedbyclient" }]);
	});

	it("closes the page on session path to prevent leaks", async () => {
		const seen: Record<string, unknown> = {};
		const renderer = makeTestRenderer(seen);

		await renderer.fetchRendered(URL, { sessionId: "test-session" });
		expect(seen.pageClosed).toBe(true);

		// Cleanup
		const { destroyBrowserSession } = await import("../session-pool.ts");
		await destroyBrowserSession("test-session");
	});

	it("loads storageState from disk when sessionId is provided", async () => {
		const { saveBrowserSessionStorageState, deleteBrowserSessionStorageState } =
			await import("../session.ts");
		await saveBrowserSessionStorageState("playwright-test-ss", {
			cookies: [{ name: "disk", value: "value" }],
			origins: [],
		});

		const seen: Record<string, unknown> = {};
		const renderer = makeTestRenderer(seen);
		await renderer.fetchRendered(URL, {
			sessionId: "playwright-test-ss",
			saveSession: true,
			browserBackend: "playwright",
		});
		expect(seen.context).toMatchObject({
			storageState: {
				cookies: [{ name: "disk", value: "value" }],
				origins: [],
			},
		});

		// Cleanup
		const { destroyBrowserSession } = await import("../session-pool.ts");
		await destroyBrowserSession("playwright-test-ss");
		await deleteBrowserSessionStorageState("playwright-test-ss");
	});

	it("saves storageState to disk when sessionId + saveSession is provided", async () => {
		const { loadBrowserSessionStorageState, deleteBrowserSessionStorageState } =
			await import("../session.ts");
		const seen: Record<string, unknown> = {};
		const renderer = makeTestRenderer(seen);
		await renderer.fetchRendered(URL, {
			sessionId: "playwright-test-save",
			saveSession: true,
			browserBackend: "playwright",
		});
		expect(seen.storageStateCalled).toBe(true);

		const loaded = await loadBrowserSessionStorageState("playwright-test-save");
		expect(loaded).toEqual({ cookies: [{ name: "test", value: "cookie" }], origins: [] });

		// Cleanup
		const { destroyBrowserSession } = await import("../session-pool.ts");
		await destroyBrowserSession("playwright-test-save");
		await deleteBrowserSessionStorageState("playwright-test-save");
	});

	it("deletes storageState from disk when clearSession is provided", async () => {
		const { saveBrowserSessionStorageState, loadBrowserSessionStorageState } =
			await import("../session.ts");
		await saveBrowserSessionStorageState("playwright-test-clear", {
			cookies: [],
			origins: [],
		});

		const seen: Record<string, unknown> = {};
		const renderer = makeTestRenderer(seen);
		await renderer.fetchRendered(URL, { sessionId: "playwright-test-clear", clearSession: true });

		const loaded = await loadBrowserSessionStorageState("playwright-test-clear");
		expect(loaded).toBeUndefined();
	});

	it("dedupes hostname safety checks within a render", async () => {
		const seen: Record<string, unknown> = {};
		const checks = new Map<string, number>();
		const otherHost = "https://example.com/asset.js";
		const renderer = createPlaywrightRenderer({
			browserLoader: (backend, opts) =>
				Promise.resolve(
					fakeBrowser(backend, opts, seen, {
						requestUrls: [URL, `${URL}?asset=1`, otherHost, `${otherHost}?v=2`],
					}),
				),
			safetyCheck: (input) => countingSafetyCheck(input, checks),
		});

		await expect(renderer.fetchRendered(URL)).resolves.toMatchObject({
			finalUrl: `${URL}#rendered`,
		});
		expect(Object.fromEntries(checks)).toEqual({
			"93.184.216.34": 1,
			"example.com": 1,
		});
	});

	it("only captures axTree when format is ax-tree", async () => {
		const seen: Record<string, unknown> = {};
		const renderer = makeTestRenderer(seen);

		const normalResult = await renderer.fetchRendered(URL);
		expect(normalResult.axTree).toBeUndefined();

		const axResult = await renderer.fetchRendered(URL, { format: "ax-tree" });
		expect(axResult.axTree).toEqual("rootWebArea\n");
	});

	it("uses cloak backend by default", async () => {
		const seenBackend: { backend?: string } = {};
		const renderer = createPlaywrightRenderer({
			browserLoader: async (backend, opts) => {
				seenBackend.backend = backend;
				return fakeBrowser(backend, opts, {});
			},
		});

		await renderer.fetchRendered(URL);
		expect(seenBackend.backend).toBe("cloak");
	});

	it("respects explicit playwright backend option", async () => {
		const seenBackend: { backend?: string } = {};
		const renderer = createPlaywrightRenderer({
			browserLoader: async (backend, opts) => {
				seenBackend.backend = backend;
				return fakeBrowser(backend, opts, {});
			},
		});

		await renderer.fetchRendered(URL, { browserBackend: "playwright" });
		expect(seenBackend.backend).toBe("playwright");
	});

	it("respects explicit cloak backend option", async () => {
		const seenBackend: { backend?: string } = {};
		const renderer = createPlaywrightRenderer({
			browserLoader: async (backend, opts) => {
				seenBackend.backend = backend;
				return fakeBrowser(backend, opts, {});
			},
		});

		await renderer.fetchRendered(URL, { browserBackend: "cloak" });
		expect(seenBackend.backend).toBe("cloak");
	});

	it("factory-level browserBackend option flows through to the launcher", async () => {
		const seenBackend: { backend?: string } = {};
		const renderer = createPlaywrightRenderer({
			browserBackend: "playwright",
			browserLoader: async (backend, opts) => {
				seenBackend.backend = backend;
				return fakeBrowser(backend, opts, {});
			},
		});

		await renderer.fetchRendered(URL);
		expect(seenBackend.backend).toBe("playwright");
	});

	it("per-call browserBackend option overrides factory default", async () => {
		const seenBackend: { backend?: string } = {};
		const renderer = createPlaywrightRenderer({
			browserBackend: "playwright",
			browserLoader: async (backend, opts) => {
				seenBackend.backend = backend;
				return fakeBrowser(backend, opts, {});
			},
		});

		await renderer.fetchRendered(URL, { browserBackend: "cloak" });
		expect(seenBackend.backend).toBe("cloak");
	});
});

// ── Test helpers ───────────────────────────────────────────

interface FakeBrowserOptions {
	finalUrl?: string;
	requestUrls?: string[];
}

interface FakeRoute {
	abort(errorCode?: string): Promise<void>;
	continue(): Promise<void>;
	request(): { url(): string; frame(): { page(): unknown } };
}

function safeResult(value: string): SafeUrlResult {
	return {
		url: new globalThis.URL(value),
		normalizedUrl: value,
		checkedAddresses: [],
	};
}

function makeTestRenderer(
	seen: Record<string, unknown>,
	options?: FakeBrowserOptions,
): BrowserRenderer {
	return createPlaywrightRenderer({
		browserLoader: (backend, opts) => Promise.resolve(fakeBrowser(backend, opts, seen, options)),
	});
}

function fakeBrowser(
	_backend: BrowserBackend,
	_opts: BrowserRenderOptions,
	seen: Record<string, unknown>,
	options: FakeBrowserOptions = {},
): Browser {
	let routeHandler: ((route: FakeRoute) => Promise<void>) | undefined;
	const browser: any = {
		newContext: async (contextOptions: Record<string, unknown>) => {
			seen.context = contextOptions;
			const browserContext: any = {
				addCookies: async (cookies: Record<string, string>[]) => {
					seen.cookies = cookies;
				},
				route: async (glob: string, handler: (route: FakeRoute) => Promise<void>) => {
					seen.routeGlob = glob;
					routeHandler = handler;
				},
				storageState: async () => {
					seen.storageStateCalled = true;
					return { cookies: [{ name: "test", value: "cookie" }], origins: [] };
				},
				close: async () => {
					/* no-op */
				},
				newPage: async () => {
					const page: any = {
						goto: async (requestUrl: string, gotoOptions: Record<string, unknown>) => {
							seen.goto = gotoOptions;
							for (const url of options.requestUrls ?? [requestUrl]) {
								await routeHandler?.(fakeRoute(seen, url, page));
							}
							return { status: () => 204 };
						},
						content: async () => "<html>rendered</html>",
						title: async () => "",
						context: () => browserContext,
						url: () => options.finalUrl ?? `${URL}#rendered`,
						close: async () => {
							seen.pageClosed = true;
						},
						evaluate: async () => undefined,
						ariaSnapshot: async () => "rootWebArea\n",
					};
					return page;
				},
			};
			return browserContext;
		},
		close: async () => {
			seen.closed = true;
		},
	};
	return browser;
}

function fakeRoute(seen: Record<string, unknown>, url: string, page: unknown): FakeRoute {
	return {
		abort: async (errorCode?: string) => {
			const aborted = (seen.aborted as Array<Record<string, string | undefined>> | undefined) ?? [];
			aborted.push({ url, errorCode });
			seen.aborted = aborted;
		},
		continue: async () => {
			const continued = (seen.continued as string[] | undefined) ?? [];
			continued.push(url);
			seen.continued = continued;
		},
		request: () => ({ url: () => url, frame: () => ({ page: () => page }) }),
	};
}
