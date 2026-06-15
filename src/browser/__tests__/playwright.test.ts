/** @file Browser **tests** playwright.test module. */
import { afterEach, describe, expect, it } from "vitest";

import type { SafeUrlResult } from "../../http/url-safety.ts";
import {
	browserAct,
	createPlaywrightRenderer,
	interactiveSnapshot,
	outlineSnapshot,
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

describe("browserAct", () => {
	const SESSION = "browser-act-test";

	afterEach(async () => {
		const { destroyBrowserSession } = await import("../session-pool.ts");
		await destroyBrowserSession(SESSION);
	});

	it("persists fill state across calls with the same sessionId", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		await browserAct(
			{
				action: "navigate",
				sessionId: SESSION,
				url: URL,
				browserBackend: "playwright",
			},
			undefined,
			{ browserLoader: loader },
		);
		await browserAct(
			{
				action: "fill",
				sessionId: SESSION,
				selector: "#email",
				value: "user@example.com",
				browserBackend: "playwright",
			},
			undefined,
			{ browserLoader: loader },
		);
		const snapshot = await browserAct(
			{
				action: "snapshot",
				sessionId: SESSION,
				browserBackend: "playwright",
			},
			undefined,
			{ browserLoader: loader },
		);

		expect(snapshot.snapshot).toContain("user@example.com");
		expect(seen.ariaSnapshotOptions).toEqual({ mode: "ai" });
		expect(seen.pageClosed).toBeUndefined();
	});

	it("binds locale/timezone/browserProfile into the session-acquire launch options", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) => {
			seen.loaderOptions = opts;
			return Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));
		};

		await browserAct(
			{
				action: "navigate",
				sessionId: SESSION,
				url: URL,
				browserBackend: "playwright",
				locale: "fr-FR",
				timezone: "Europe/Paris",
				browserProfile: "UA/1.0",
			},
			undefined,
			{ browserLoader: loader },
		);

		expect(seen.loaderOptions).toMatchObject({
			locale: "fr-FR",
			timezone: "Europe/Paris",
			browserProfile: "UA/1.0",
		});
	});

	it("blocks unsafe navigate URLs", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		await expect(
			browserAct(
				{
					action: "navigate",
					sessionId: SESSION,
					url: "http://127.0.0.1/admin",
					browserBackend: "playwright",
				},
				undefined,
				{ browserLoader: loader },
			),
		).rejects.toMatchObject({
			name: "BrowserRenderError",
			structured: { code: "BROWSER_BLOCKED_PRIVATE_URL" },
		});
	});

	it("surfaces a subresource blocked by the route guard", async () => {
		const seen: Record<string, unknown> = {};
		const privateUrl = "http://127.0.0.1/admin";
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(
				fakeInteractiveBrowser(backend, opts, seen, { requestUrls: [URL, privateUrl] }),
			);

		await expect(
			browserAct(
				{ action: "navigate", sessionId: SESSION, url: URL, browserBackend: "playwright" },
				undefined,
				{ browserLoader: loader },
			),
		).rejects.toMatchObject({
			name: "BrowserRenderError",
			structured: { code: "BROWSER_BLOCKED_PRIVATE_URL", finalUrl: privateUrl },
		});
	});

	it("works with cloak backend", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		const result = await browserAct(
			{
				action: "snapshot",
				sessionId: SESSION,
				browserBackend: "cloak",
			},
			undefined,
			{ browserLoader: loader },
		);

		expect(result.action).toBe("snapshot");
		expect(result.snapshot).toContain("Submit");
	});

	it("translates an @eN ref to the aria-ref selector engine", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		await browserAct(
			{ action: "click", sessionId: SESSION, selector: "@e5", browserBackend: "playwright" },
			undefined,
			{ browserLoader: loader },
		);

		expect(seen.clicked).toBe("aria-ref=e5");
	});

	it("passes a plain CSS selector through unchanged", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		await browserAct(
			{
				action: "fill",
				sessionId: SESSION,
				selector: "#email",
				value: "x",
				browserBackend: "playwright",
			},
			undefined,
			{ browserLoader: loader },
		);

		expect(seen.filled).toEqual({ selector: "#email", value: "x" });
	});

	it("reports status, backend and duration for the status line", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		const result = await browserAct(
			{ action: "navigate", sessionId: SESSION, url: URL, browserBackend: "playwright" },
			undefined,
			{ browserLoader: loader },
		);

		expect(result.status).toBe(204);
		expect(result.backend).toBe("playwright");
		expect(typeof result.durationMs).toBe("number");
	});

	it("filters the snapshot to a flat interactive-only list by default", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		const result = await browserAct(
			{ action: "snapshot", sessionId: SESSION, browserBackend: "playwright" },
			undefined,
			{ browserLoader: loader },
		);

		expect(result.snapshot).toContain('button "Submit"');
		expect(result.snapshot).toContain("[ref=e3]"); // refs preserved
		expect(result.snapshot).not.toContain("main"); // non-interactive container dropped
		expect(result.snapshot).not.toContain("- "); // flattened, no YAML nesting
	});

	it("returns the full tree when detail is full", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		const result = await browserAct(
			{ action: "snapshot", sessionId: SESSION, browserBackend: "playwright", detail: "full" },
			undefined,
			{ browserLoader: loader },
		);

		expect(result.snapshot).toContain("- main [ref=e1]");
		expect(result.snapshot).toContain('button "Submit"');
	});

	it("scopes the snapshot to a region via the locator", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		const result = await browserAct(
			{ action: "snapshot", sessionId: SESSION, browserBackend: "playwright", scope: "#search" },
			undefined,
			{ browserLoader: loader },
		);

		expect(seen.scopeLocator).toBe("#search");
		expect(seen.scopedAriaOptions).toEqual({ mode: "ai" });
		expect(result.snapshot).toContain('button "Go"'); // from the scoped region
		expect(result.snapshot).not.toContain("Submit"); // page-level tree not used
	});

	it("returns an orientation outline when detail is outline", async () => {
		const seen: Record<string, unknown> = {};
		const loader = (backend: BrowserBackend, opts: BrowserRenderOptions) =>
			Promise.resolve(fakeInteractiveBrowser(backend, opts, seen));

		const result = await browserAct(
			{ action: "snapshot", sessionId: SESSION, browserBackend: "playwright", detail: "outline" },
			undefined,
			{ browserLoader: loader },
		);

		expect(result.snapshot).toContain("landmarks: main");
		expect(result.snapshot).toContain("button 1");
		expect(result.snapshot).not.toContain("[ref="); // no refs in the outline
	});
});

describe("snapshot shaping", () => {
	it("trims link URLs (query + fragment) and dedupes repeats, keeping the first ref", () => {
		const yaml = [
			"- navigation [ref=e1]:",
			'  - link "Home" [ref=e2]:',
			"    - /url: https://x.com/home?utm=abc#frag",
			'  - link "Home" [ref=e9]:',
			"    - /url: https://x.com/home?utm=zzz",
			'  - button "Menu" [ref=e3] [cursor=pointer]',
		].join("\n");
		const out = interactiveSnapshot(yaml);
		expect(out).toContain('link "Home" [ref=e2] https://x.com/home');
		expect(out).not.toContain("utm=");
		expect(out).not.toContain("#frag");
		expect(out).not.toContain("[ref=e9]"); // exact duplicate collapsed
		expect(out).not.toContain("cursor=pointer");
		expect(out).toContain('button "Menu" [ref=e3]');
	});

	it("caps the interactive list and summarises the overflow", () => {
		const yaml = Array.from(
			{ length: 170 },
			(_unused, i) => `- link "Item ${i}" [ref=e${i}]:\n  - /url: https://x.com/i${i}`,
		).join("\n");
		const out = interactiveSnapshot(yaml).split("\n");
		expect(out).toHaveLength(151); // 150 shown + 1 summary line
		expect(out[150]).toContain("+20 more");
	});

	it("narrows the interactive list to the requested roles", () => {
		const yaml =
			'- main [ref=e1]:\n  - textbox "Email" [ref=e2]\n  - button "Submit" [ref=e3]\n  - link "Home" [ref=e4]';
		expect(interactiveSnapshot(yaml, ["textbox", "button"])).toBe(
			'textbox "Email" [ref=e2]\nbutton "Submit" [ref=e3]',
		);
	});

	it("builds an orientation outline: landmarks, role counts, headings, no refs", () => {
		const yaml = [
			"- banner [ref=e1]:",
			'  - heading "Top Stories" [level=1] [ref=e2]',
			'  - link "A" [ref=e3]',
			"- navigation [ref=e4]:",
			'  - link "B" [ref=e5]',
			'  - link "C" [ref=e6]',
			"- main [ref=e7]:",
			'  - heading "Sports" [level=2] [ref=e8]',
			'  - button "Play" [ref=e9]',
		].join("\n");
		const out = outlineSnapshot(yaml);
		expect(out).toContain("landmarks: banner, navigation, main");
		expect(out).toContain("link 3");
		expect(out).toContain("button 1");
		expect(out).toContain("# Top Stories");
		expect(out).toContain("## Sports");
		expect(out).not.toContain("[ref=");
		expect(out).toContain('detail:"full"');
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
	return fakeInteractiveBrowser(_backend, _opts, seen, options);
}

function fakeInteractiveBrowser(
	_backend: BrowserBackend,
	_opts: BrowserRenderOptions,
	seen: Record<string, unknown>,
	options: FakeBrowserOptions = {},
): Browser {
	let routeHandler: ((route: FakeRoute) => Promise<void>) | undefined;
	let sharedPage: unknown;
	const fillValues = new Map<string, string>();
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
					if (sharedPage) {
						seen.reusedPage = true;
						return sharedPage;
					}
					let closed = false;
					const page: any = {
						isClosed: () => closed,
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
							closed = true;
							seen.pageClosed = true;
						},
						click: async (selector: string) => {
							seen.clicked = selector;
						},
						fill: async (selector: string, value: string) => {
							fillValues.set(selector, value);
							seen.filled = { selector, value };
						},
						selectOption: async (selector: string, value: string) => {
							fillValues.set(selector, value);
							seen.selected = { selector, value };
							return [value];
						},
						evaluate: async () => undefined,
						ariaSnapshot: async (axOptions?: { mode?: string }) => {
							seen.ariaSnapshotOptions = axOptions;
							if (axOptions?.mode !== "ai") return "rootWebArea\n"; // ax-tree path (format:"ax-tree")
							const values = [...fillValues.values()];
							const filled =
								values.length > 0 ? `  - textbox "${values.join(", ")}" [ref=e2]\n` : "";
							return `- main [ref=e1]:\n${filled}  - button "Submit" [ref=e3]\n`;
						},
						locator: (selector: string) => {
							seen.scopeLocator = selector;
							return {
								first: () => ({
									ariaSnapshot: async (axOptions?: { mode?: string }) => {
										seen.scopedAriaOptions = axOptions;
										return '- form [ref=e8]:\n  - searchbox "Search" [ref=e9]\n  - button "Go" [ref=e10]\n';
									},
								}),
							};
						},
					};
					sharedPage = page;
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
