/** @file Http **tests** proxy-config.test module. */
import { describe, expect, it } from "vitest";

import { resolveEnvProxyForUrl, shouldBypassProxy } from "../proxy-config.ts";

describe("resolveEnvProxyForUrl", () => {
	it("returns HTTPS_PROXY for https:// targets", () => {
		const env = { HTTPS_PROXY: "http://localhost:8080" };
		expect(resolveEnvProxyForUrl("https://example.com", env)).toBe("http://localhost:8080");
	});

	it("returns lowercase https_proxy when HTTPS_PROXY is missing", () => {
		const env = { https_proxy: "http://localhost:8081" };
		expect(resolveEnvProxyForUrl("https://example.com", env)).toBe("http://localhost:8081");
	});

	it("returns HTTP_PROXY for http:// targets", () => {
		const env = { HTTP_PROXY: "http://localhost:8080" };
		expect(resolveEnvProxyForUrl("http://example.com", env)).toBe("http://localhost:8080");
	});

	it("returns lowercase http_proxy when HTTP_PROXY is missing", () => {
		const env = { http_proxy: "http://localhost:8081" };
		expect(resolveEnvProxyForUrl("http://example.com", env)).toBe("http://localhost:8081");
	});

	it("falls back to ALL_PROXY for https://", () => {
		const env = { ALL_PROXY: "http://localhost:9090" };
		expect(resolveEnvProxyForUrl("https://example.com", env)).toBe("http://localhost:9090");
	});

	it("falls back to all_proxy for http://", () => {
		const env = { all_proxy: "http://localhost:9091" };
		expect(resolveEnvProxyForUrl("http://example.com", env)).toBe("http://localhost:9091");
	});

	it("prefers HTTPS_PROXY over ALL_PROXY", () => {
		const env = { HTTPS_PROXY: "http://a:8080", ALL_PROXY: "http://b:9090" };
		expect(resolveEnvProxyForUrl("https://example.com", env)).toBe("http://a:8080");
	});

	it("prefers HTTP_PROXY over ALL_PROXY", () => {
		const env = { HTTP_PROXY: "http://a:8080", ALL_PROXY: "http://b:9090" };
		expect(resolveEnvProxyForUrl("http://example.com", env)).toBe("http://a:8080");
	});

	it("returns undefined when no proxy env vars are set", () => {
		expect(resolveEnvProxyForUrl("https://example.com", {})).toBeUndefined();
	});

	it("returns undefined when NO_PROXY=*", () => {
		const env = { HTTPS_PROXY: "http://localhost:8080", NO_PROXY: "*" };
		expect(resolveEnvProxyForUrl("https://example.com", env)).toBeUndefined();
	});

	it("returns undefined when host matches NO_PROXY", () => {
		const env = { HTTPS_PROXY: "http://localhost:8080", NO_PROXY: "example.com" };
		expect(resolveEnvProxyForUrl("https://example.com", env)).toBeUndefined();
	});

	it("returns proxy when host does not match NO_PROXY", () => {
		const env = { HTTPS_PROXY: "http://localhost:8080", NO_PROXY: "other.com" };
		expect(resolveEnvProxyForUrl("https://example.com", env)).toBe("http://localhost:8080");
	});

	it("respects NO_PROXY with port-scoped rule", () => {
		const env = { HTTPS_PROXY: "http://localhost:8080", NO_PROXY: "example.com:8443" };
		expect(resolveEnvProxyForUrl("https://example.com", env)).toBe("http://localhost:8080");
		expect(resolveEnvProxyForUrl("https://example.com:8443", env)).toBeUndefined();
	});
});

describe("shouldBypassProxy", () => {
	it("returns false when noProxyValue is empty", () => {
		expect(shouldBypassProxy("https://example.com", undefined)).toBe(false);
		expect(shouldBypassProxy("https://example.com", "")).toBe(false);
	});

	it("returns true when noProxyValue is *", () => {
		expect(shouldBypassProxy("https://example.com", "*")).toBe(true);
	});

	it("matches exact host", () => {
		expect(shouldBypassProxy("https://example.com", "example.com")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(shouldBypassProxy("https://EXAMPLE.COM", "example.com")).toBe(true);
		expect(shouldBypassProxy("https://example.com", "EXAMPLE.COM")).toBe(true);
	});

	it("matches subdomains", () => {
		expect(shouldBypassProxy("https://foo.example.com", "example.com")).toBe(true);
		expect(shouldBypassProxy("https://bar.foo.example.com", "example.com")).toBe(true);
	});

	it("matches subdomains with leading dot", () => {
		expect(shouldBypassProxy("https://foo.example.com", ".example.com")).toBe(true);
		expect(shouldBypassProxy("https://example.com", ".example.com")).toBe(true);
	});

	it("does not match unrelated hosts", () => {
		expect(shouldBypassProxy("https://example.com", "other.com")).toBe(false);
		expect(shouldBypassProxy("https://example.com", "fooexample.com")).toBe(false);
	});

	it("matches port-scoped rule", () => {
		expect(shouldBypassProxy("https://example.com:8443", "example.com:8443")).toBe(true);
		expect(shouldBypassProxy("https://example.com:8443", "example.com:443")).toBe(false);
	});

	it("handles comma-separated list", () => {
		expect(shouldBypassProxy("https://a.com", "a.com,b.com")).toBe(true);
		expect(shouldBypassProxy("https://b.com", "a.com,b.com")).toBe(true);
		expect(shouldBypassProxy("https://c.com", "a.com,b.com")).toBe(false);
	});

	it("trims whitespace around entries", () => {
		expect(shouldBypassProxy("https://a.com", " a.com , b.com ")).toBe(true);
	});

	it("matches IPv6 with brackets", () => {
		expect(shouldBypassProxy("https://[::1]", "::1")).toBe(true);
		expect(shouldBypassProxy("https://[::1]", "[::1]")).toBe(true);
	});

	it("matches IPv6 without brackets", () => {
		expect(shouldBypassProxy("https://[::1]", "::1")).toBe(true);
	});

	it("ignores empty entries", () => {
		expect(shouldBypassProxy("https://a.com", "a.com,,b.com")).toBe(true);
	});
});
