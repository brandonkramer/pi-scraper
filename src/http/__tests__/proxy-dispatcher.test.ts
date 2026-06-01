/** @file Http **tests** proxy-dispatcher.test module. */
import { describe, expect, it } from "vitest";

import { createProxyDispatcher, isSupportedProxyScheme } from "../proxy-dispatcher.ts";

function getStructuredCode(error: unknown): string | undefined {
	if (
		error instanceof Error &&
		"structured" in error &&
		typeof (error as { structured?: unknown }).structured === "object" &&
		(error as { structured: { code?: unknown } }).structured
	) {
		return (error as { structured: { code?: string } }).structured.code;
	}
	return undefined;
}

describe("isSupportedProxyScheme", () => {
	it("returns true for http://", () => {
		expect(isSupportedProxyScheme("http://127.0.0.1:8080")).toBe(true);
	});
	it("returns true for https://", () => {
		expect(isSupportedProxyScheme("https://127.0.0.1:8080")).toBe(true);
	});
	it("returns true for socks5://", () => {
		expect(isSupportedProxyScheme("socks5://127.0.0.1:1080")).toBe(true);
	});
	it("returns true for socks://", () => {
		expect(isSupportedProxyScheme("socks://127.0.0.1:1080")).toBe(true);
	});
	it("returns true for socks4://", () => {
		expect(isSupportedProxyScheme("socks4://127.0.0.1:1080")).toBe(true);
	});
	it("returns false for socks5h://", () => {
		expect(isSupportedProxyScheme("socks5h://127.0.0.1:1080")).toBe(false);
	});
	it("returns false for socks4a://", () => {
		expect(isSupportedProxyScheme("socks4a://127.0.0.1:1080")).toBe(false);
	});
	it("returns false for ftp://", () => {
		expect(isSupportedProxyScheme("ftp://127.0.0.1:21")).toBe(false);
	});
	it("returns false for malformed URL", () => {
		expect(isSupportedProxyScheme("not-a-url")).toBe(false);
	});
});

describe("createProxyDispatcher", () => {
	it("returns ProxyAgent for http://", () => {
		const dispatcher = createProxyDispatcher("http://127.0.0.1:8080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("returns ProxyAgent for https://", () => {
		const dispatcher = createProxyDispatcher("https://127.0.0.1:8080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("returns Socks5ProxyAgent for socks5://", () => {
		const dispatcher = createProxyDispatcher("socks5://127.0.0.1:1080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("returns Socks5ProxyAgent for socks://", () => {
		const dispatcher = createProxyDispatcher("socks://127.0.0.1:1080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("returns Socks4ProxyAgent for socks4://", () => {
		const dispatcher = createProxyDispatcher("socks4://127.0.0.1:1080");
		expect(dispatcher).toBeDefined();
		expect(typeof dispatcher.dispatch).toBe("function");
	});
	it("throws UNSUPPORTED_PROXY_SCHEME for socks5h://", () => {
		expect(() => createProxyDispatcher("socks5h://127.0.0.1:1080")).toThrow(
			"Unsupported proxy scheme",
		);
		const code = getStructuredCode(
			(() => {
				try {
					createProxyDispatcher("socks5h://127.0.0.1:1080");
				} catch (e) {
					return e;
				}
			})(),
		);
		expect(code).toBe("UNSUPPORTED_PROXY_SCHEME");
	});
	it("throws UNSUPPORTED_PROXY_SCHEME for socks4a://", () => {
		expect(() => createProxyDispatcher("socks4a://127.0.0.1:1080")).toThrow(
			"Unsupported proxy scheme",
		);
		const code = getStructuredCode(
			(() => {
				try {
					createProxyDispatcher("socks4a://127.0.0.1:1080");
				} catch (e) {
					return e;
				}
			})(),
		);
		expect(code).toBe("UNSUPPORTED_PROXY_SCHEME");
	});
	it("throws INVALID_PROXY_URL for malformed URL", () => {
		expect(() => createProxyDispatcher("not-a-url")).toThrow("Could not parse proxy URL");
		const code = getStructuredCode(
			(() => {
				try {
					createProxyDispatcher("not-a-url");
				} catch (e) {
					return e;
				}
			})(),
		);
		expect(code).toBe("INVALID_PROXY_URL");
	});
	it("throws UNSUPPORTED_PROXY_SCHEME for unknown scheme", () => {
		expect(() => createProxyDispatcher("ftp://127.0.0.1:21")).toThrow("Unsupported proxy scheme");
		const code = getStructuredCode(
			(() => {
				try {
					createProxyDispatcher("ftp://127.0.0.1:21");
				} catch (e) {
					return e;
				}
			})(),
		);
		expect(code).toBe("UNSUPPORTED_PROXY_SCHEME");
	});
});
