/** @file Unit tests for browser route guard — subresource SSRF blocking. */
import { describe, expect, it } from "vitest";

import type { SafeUrlResult } from "../../http/url-safety.ts";
import {
	assertSafeBrowserUrl,
	BrowserRenderError,
	createBrowserRouteGuard,
} from "../route-guard.ts";

const URL = "http://93.184.216.34/page";

function safeResult(value: string): SafeUrlResult {
	return {
		url: new globalThis.URL(value),
		normalizedUrl: value,
		checkedAddresses: [],
	};
}

async function alwaysSafe(input: string | URL): Promise<SafeUrlResult> {
	return safeResult(input.toString());
}

async function alwaysUnsafe(input: string | URL): Promise<SafeUrlResult> {
	throw Object.assign(new Error(`Blocked: ${input}`), { code: "PRIVATE_IP" });
}

function fakePage(): any {
	return { goto: async () => ({}) };
}

function fakeRoute(
	url: string,
	page: any,
): {
	abort: (code?: string) => Promise<void>;
	continue: () => Promise<void>;
	request: () => { url: () => string; frame: () => { page: () => any } };
} {
	return {
		abort: async () => undefined,
		continue: async () => undefined,
		request: () => ({ url: () => url, frame: () => ({ page: () => page }) }),
	};
}

describe("createBrowserRouteGuard", () => {
	it("allows http and https subresources", async () => {
		const guard = createBrowserRouteGuard(alwaysSafe);
		const page = fakePage();
		const actions: string[] = [];
		const route = {
			...fakeRoute("https://cdn.example.com/script.js", page),
			continue: async () => {
				actions.push("continue");
			},
		};

		await guard.handler(route);
		expect(actions).toEqual(["continue"]);
		expect(guard.consumeError(page, URL)).toBeUndefined();
	});

	it("blocks file: URLs", async () => {
		const guard = createBrowserRouteGuard(alwaysSafe);
		const page = fakePage();
		const codes: Array<string | undefined> = [];
		const route = {
			...fakeRoute("file:///etc/passwd", page),
			abort: async (code?: string) => {
				codes.push(code);
			},
		};

		await guard.handler(route);
		expect(codes).toEqual(["blockedbyclient"]);
		const error = guard.consumeError(page, URL);
		expect(error).toBeInstanceOf(BrowserRenderError);
		expect(error?.structured.code).toBe("BROWSER_BLOCKED_PRIVATE_URL");
		expect(error?.structured.finalUrl).toBe("file:///etc/passwd");
		expect(error?.structured.url).toBe(URL);
	});

	it("blocks unsupported schemes", async () => {
		const guard = createBrowserRouteGuard(alwaysSafe);
		const page = fakePage();
		const route = {
			...fakeRoute("ftp://evil.com/data", page),
			abort: async () => undefined,
		};

		await guard.handler(route);
		const error = guard.consumeError(page, URL);
		expect(error?.structured.code).toBe("BROWSER_BLOCKED_PRIVATE_URL");
		expect(error?.structured.finalUrl).toBe("ftp://evil.com/data");
	});

	it("allows benign browser schemes", async () => {
		const guard = createBrowserRouteGuard(alwaysSafe);
		const page = fakePage();
		const schemes = [
			"about:blank",
			"blob:abc",
			"data:text/plain,hi",
			"chrome-extension://id",
			"devtools://bundled/panel",
		];
		const actions: string[] = [];

		for (const scheme of schemes) {
			const route = {
				...fakeRoute(scheme, page),
				continue: async () => {
					actions.push("continue");
				},
			};
			await guard.handler(route);
		}
		expect(actions).toEqual(["continue", "continue", "continue", "continue", "continue"]);
		expect(guard.consumeError(page, URL)).toBeUndefined();
	});

	it("blocks private IPs via safety check", async () => {
		const guard = createBrowserRouteGuard(alwaysUnsafe);
		const page = fakePage();
		const route = {
			...fakeRoute("http://127.0.0.1/admin", page),
			abort: async () => undefined,
		};

		await guard.handler(route);
		const error = guard.consumeError(page, URL);
		expect(error?.structured.code).toBe("BROWSER_BLOCKED_PRIVATE_URL");
		expect(error?.structured.finalUrl).toBe("http://127.0.0.1/admin");
	});

	it("blocks AWS metadata IP", async () => {
		const guard = createBrowserRouteGuard(alwaysUnsafe);
		const page = fakePage();
		const route = {
			...fakeRoute("http://169.254.169.254/latest/meta-data/", page),
			abort: async () => undefined,
		};

		await guard.handler(route);
		const error = guard.consumeError(page, URL);
		expect(error?.structured.finalUrl).toBe("http://169.254.169.254/latest/meta-data/");
	});

	it("only records the first blocked subresource per page", async () => {
		const guard = createBrowserRouteGuard(alwaysUnsafe);
		const page = fakePage();
		const route1 = { ...fakeRoute("http://127.0.0.1/a", page), abort: async () => undefined };
		const route2 = { ...fakeRoute("http://127.0.0.1/b", page), abort: async () => undefined };

		await guard.handler(route1);
		await guard.handler(route2);
		const error = guard.consumeError(page, URL);
		expect(error?.structured.finalUrl).toBe("http://127.0.0.1/a");
	});

	it("clears error after consumeError so reuse is safe", async () => {
		const guard = createBrowserRouteGuard(alwaysUnsafe);
		const page = fakePage();
		const route = { ...fakeRoute("http://127.0.0.1/admin", page), abort: async () => undefined };

		await guard.handler(route);
		expect(guard.consumeError(page, URL)).toBeDefined();
		expect(guard.consumeError(page, URL)).toBeUndefined();
	});

	it("supports two separate renders on the same page", async () => {
		const guard = createBrowserRouteGuard(alwaysUnsafe);
		const page = fakePage();
		const routeA = { ...fakeRoute("http://127.0.0.1/a", page), abort: async () => undefined };
		const routeB = { ...fakeRoute("http://127.0.0.1/b", page), abort: async () => undefined };

		// First render
		await guard.handler(routeA);
		const errorA = guard.consumeError(page, URL);
		expect(errorA?.structured.finalUrl).toBe("http://127.0.0.1/a");

		// Second render — fresh error, not stale
		await guard.handler(routeB);
		const errorB = guard.consumeError(page, URL);
		expect(errorB?.structured.finalUrl).toBe("http://127.0.0.1/b");
	});
});

describe("assertSafeBrowserUrl", () => {
	it("returns safe result when state is absent", async () => {
		const result = await assertSafeBrowserUrl(
			"https://example.com/path",
			"https://example.com/path",
		);
		expect(result.normalizedUrl).toBe("https://example.com/path");
	});

	it("dedupes hostname checks via checkedHosts", async () => {
		const checks: string[] = [];
		const state = {
			check: async (input: string | URL) => {
				checks.push(input.toString());
				return safeResult(input.toString());
			},
			checkedHosts: new Map(),
		};

		await assertSafeBrowserUrl("https://example.com/a", "url", undefined, state);
		await assertSafeBrowserUrl("https://example.com/b", "url", undefined, state);
		expect(checks).toEqual(["https://example.com/a"]);
	});
});
