/** @file Tests for fingerprint session cookie support. */
import { describe, expect, it } from "vitest";

import type { FetchSession } from "../../session.ts";
import { setCookiesFromResponse } from "../adapter.ts";

describe("setCookiesFromResponse", () => {
	it("persists single Set-Cookie header", () => {
		const session = makeSession();
		const headers: Record<string, string | string[]> = {
			"set-cookie": "foo=bar; Domain=example.com",
		};
		setCookiesFromResponse(session, headers, new URL("https://example.com/page"));

		expect(session.cookies).toHaveLength(1);
		expect(session.cookies[0].name).toBe("foo");
		expect(session.cookies[0].value).toBe("bar");
	});

	it("persists multiple Set-Cookie headers from array", () => {
		const session = makeSession();
		const headers: Record<string, string | string[]> = {
			"set-cookie": ["a=1; Domain=example.com", "b=2; Domain=example.com"],
		};
		setCookiesFromResponse(session, headers, new URL("https://example.com/page"));

		expect(session.cookies).toHaveLength(2);
		expect(session.cookies[0].name).toBe("a");
		expect(session.cookies[1].name).toBe("b");
	});

	it("ignores missing set-cookie", () => {
		const session = makeSession();
		setCookiesFromResponse(
			session,
			{ "content-type": "text/html" },
			new URL("https://example.com/page"),
		);
		expect(session.cookies).toHaveLength(0);
	});

	it("rejects cookies with non-matching Domain", () => {
		const session = makeSession();
		const headers: Record<string, string | string[]> = {
			"set-cookie": "x=1; Domain=evil.com",
		};
		setCookiesFromResponse(session, headers, new URL("https://example.com/page"));
		expect(session.cookies).toHaveLength(0);
	});
});

function makeSession(): FetchSession {
	return {
		id: "test",
		createdAt: new Date().toISOString(),
		lastUsedAt: new Date().toISOString(),
		cookies: [],
		defaultHeaders: {},
	};
}

describe("headersFromImpit multi Set-Cookie", () => {
	it("collects multiple Set-Cookie headers into array via getSetCookie()", async () => {
		const { makeImpitBackend } = await import("../impit-backend.ts");

		const MockImpit = class {
			async fetch() {
				return {
					status: 200,
					statusText: "OK",
					headers: multiSetCookieHeaders(["a=1; Path=/", "b=2; Path=/"]),
					body: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("ok"));
							controller.close();
						},
					}),
					url: "https://example.com/",
				};
			}
		};

		const backend = await makeImpitBackend(
			{ browserProfile: "chrome", osProfile: "default", host: "example.com" },
			MockImpit as never,
		);

		const result = await backend.fetchOnce("https://example.com/", {
			method: "GET",
			headers: {},
			timeoutMs: 5000,
			maxBytes: 1024,
			browserProfile: "chrome",
			osProfile: "default",
		});

		const sc = result.headers?.["set-cookie"];
		expect(Array.isArray(sc)).toBe(true);
		expect(sc).toHaveLength(2);
		expect(sc?.[0]).toBe("a=1; Path=/");
		expect(sc?.[1]).toBe("b=2; Path=/");
	});

	it("single Set-Cookie header still works", async () => {
		const { makeImpitBackend } = await import("../impit-backend.ts");

		const MockImpit = class {
			async fetch() {
				return {
					status: 200,
					statusText: "OK",
					headers: multiSetCookieHeaders(["a=1; Path=/"]),
					body: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("ok"));
							controller.close();
						},
					}),
					url: "https://example.com/",
				};
			}
		};

		const backend = await makeImpitBackend(
			{ browserProfile: "chrome", osProfile: "default", host: "example.com" },
			MockImpit as never,
		);

		const result = await backend.fetchOnce("https://example.com/", {
			method: "GET",
			headers: {},
			timeoutMs: 5000,
			maxBytes: 1024,
			browserProfile: "chrome",
			osProfile: "default",
		});

		const sc = result.headers?.["set-cookie"];
		expect(Array.isArray(sc)).toBe(true);
		expect(sc).toHaveLength(1);
		expect(sc?.[0]).toBe("a=1; Path=/");
	});

	it("no Set-Cookie returns headers without set-cookie key", async () => {
		const { makeImpitBackend } = await import("../impit-backend.ts");

		const MockImpit = class {
			async fetch() {
				return {
					status: 200,
					statusText: "OK",
					headers: new Headers({ "content-type": "text/html" }),
					body: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("ok"));
							controller.close();
						},
					}),
					url: "https://example.com/",
				};
			}
		};

		const backend = await makeImpitBackend(
			{ browserProfile: "chrome", osProfile: "default", host: "example.com" },
			MockImpit as never,
		);

		const result = await backend.fetchOnce("https://example.com/", {
			method: "GET",
			headers: {},
			timeoutMs: 5000,
			maxBytes: 1024,
			browserProfile: "chrome",
			osProfile: "default",
		});

		expect(result.headers?.["set-cookie"]).toBeUndefined();
	});
});

function multiSetCookieHeaders(setCookies: string[]): Headers {
	const entries: [string, string][] = setCookies.map(
		(sc) => ["set-cookie", sc] as [string, string],
	);
	entries.push(["content-type", "text/html"]);
	return {
		entries: () => entries[Symbol.iterator](),
		forEach: () => {
			/* no-op — satisfies Headers interface */
		},
		get: (key: string) => {
			const entry = entries.find(([k]) => k === key);
			return entry ? entry[1] : null;
		},
		has: (key: string) => entries.some(([k]) => k === key),
		keys: () => entries.map(([k]) => k)[Symbol.iterator](),
		values: () => entries.map(([, v]) => v)[Symbol.iterator](),
		getSetCookie: () => setCookies,
		[Symbol.iterator]: () => entries[Symbol.iterator](),
	} as unknown as Headers;
}
