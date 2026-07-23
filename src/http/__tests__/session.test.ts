/** @file Http **tests** session.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeStorageDbs } from "../../storage/db/open.ts";
import {
	buildCookieHeader,
	deleteSessionAndStorage,
	getOrCreateSession,
	mergeSessionHeaders,
	parseSetCookie,
	saveSessionToStorage,
	updateSessionCookies,
	type FetchSession,
} from "../session.ts";

let rootDir: string;
let originalStorageRoot: string | undefined;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-session-"));
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	await closeStorageDbs();
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
	await rm(rootDir, { recursive: true, force: true });
});

describe("session persistence", () => {
	it("creates a new session when none exists", async () => {
		const session = await getOrCreateSession("test-1");
		expect(session.id).toBe("test-1");
		expect(session.cookies).toEqual([]);
	});

	it("survives reload via SQLite", async () => {
		const first = await getOrCreateSession("test-2");
		first.cookies.push({
			name: "sid",
			value: "abc",
			domain: "example.com",
			path: "/",
		});
		first.defaultBrowserProfile = "chrome";
		await saveSessionToStorage("test-2");

		// simulate reload: clear memory
		const { deleteSession } = await import("../session.ts");
		deleteSession("test-2");

		const afterReload = await getOrCreateSession("test-2");
		expect(afterReload.cookies).toHaveLength(1);
		expect(afterReload.cookies[0]?.value).toBe("abc");
		expect(afterReload.defaultBrowserProfile).toBe("chrome");
	});

	it("deletes session from memory and storage", async () => {
		const session = await getOrCreateSession("test-3");
		session.cookies.push({ name: "x", value: "y" });
		await saveSessionToStorage("test-3");
		await deleteSessionAndStorage("test-3");

		const afterDelete = await getOrCreateSession("test-3");
		expect(afterDelete.cookies).toEqual([]);
	});

	it("preserves domain scope across SQLite roundtrip", async () => {
		const first = await getOrCreateSession("roundtrip");
		updateSessionCookies(first, ["foo=bar; Domain=example.com"], "example.com", "/");
		await saveSessionToStorage("roundtrip");

		const { deleteSession } = await import("../session.ts");
		deleteSession("roundtrip");

		const reloaded = await getOrCreateSession("roundtrip");
		expect(buildCookieHeader(reloaded, "sub.example.com", "/", "https")).toBe("foo=bar");
	});
});

describe("parseSetCookie", () => {
	it("sets hostOnly when no Domain attribute is present", () => {
		const cookie = parseSetCookie("foo=bar", "acme.com", "/")!;
		expect(cookie.name).toBe("foo");
		expect(cookie.value).toBe("bar");
		expect(cookie.domain).toBe("acme.com");
		expect(cookie.hostOnly).toBe(true);
		expect(cookie.path).toBe("/");
	});

	it("strips leading dot and lowercases explicit Domain", () => {
		const cookie = parseSetCookie("foo=bar; Domain=.Example.COM", "example.com", "/")!;
		expect(cookie.domain).toBe("example.com");
		expect(cookie.hostOnly).toBe(false);
		expect(cookie.path).toBe("/");
	});

	it("preserves Secure, HttpOnly, SameSite", () => {
		const cookie = parseSetCookie("foo=bar; Secure; HttpOnly; SameSite=Strict", "acme.com", "/")!;
		expect(cookie.secure).toBe(true);
		expect(cookie.httpOnly).toBe(true);
		expect(cookie.sameSite).toBe("Strict");
	});

	it("rejects cross-origin Domain attribute", () => {
		expect(parseSetCookie("sid=x; Domain=victim.com", "attacker.com", "/")).toBeUndefined();
	});

	it("accepts exact host Domain match", () => {
		const cookie = parseSetCookie("sid=x; Domain=example.com", "example.com", "/")!;
		expect(cookie.domain).toBe("example.com");
		expect(cookie.hostOnly).toBe(false);
	});

	it("accepts subdomain response for parent Domain", () => {
		const cookie = parseSetCookie("sid=x; Domain=example.com", "sub.example.com", "/")!;
		expect(cookie.domain).toBe("example.com");
	});

	it("rejects suffix-match Domain (badexample.com vs example.com)", () => {
		expect(parseSetCookie("sid=x; Domain=example.com", "badexample.com", "/")).toBeUndefined();
	});

	it("rejects unrelated Domain", () => {
		expect(parseSetCookie("sid=x; Domain=other.com", "example.com", "/")).toBeUndefined();
	});

	it("defaults missing Path to the request URI directory (RFC 6265 §5.1.4)", () => {
		// uri-path with multiple slashes — strip to last "/"
		expect(parseSetCookie("foo=bar", "acme.com", "/account/login")?.path).toBe("/account");
		expect(parseSetCookie("foo=bar", "acme.com", "/account/orders/123")?.path).toBe(
			"/account/orders",
		);
		// uri-path with a single leading slash — output "/"
		expect(parseSetCookie("foo=bar", "acme.com", "/login")?.path).toBe("/");
		// uri-path is exactly "/" — output "/"
		expect(parseSetCookie("foo=bar", "acme.com", "/")?.path).toBe("/");
		// uri-path empty — output "/"
		expect(parseSetCookie("foo=bar", "acme.com", "")?.path).toBe("/");
		// uri-path lacks leading slash — output "/"
		expect(parseSetCookie("foo=bar", "acme.com", "abc")?.path).toBe("/");
	});

	it("preserves explicit Path attribute over default-path", () => {
		const cookie = parseSetCookie("foo=bar; Path=/admin", "acme.com", "/account/login")!;
		expect(cookie.path).toBe("/admin");
	});

	it("falls back to default-path when explicit Path is empty or invalid (RFC 6265 §5.2.4)", () => {
		// Path= (empty) — fall back to default-path
		expect(parseSetCookie("foo=bar; Path=", "acme.com", "/account/login")?.path).toBe("/account");
		// Path=abc (no leading "/") — fall back to default-path
		expect(parseSetCookie("foo=bar; Path=abc", "acme.com", "/account/login")?.path).toBe(
			"/account",
		);
		// Both invalid Path cases at root path → "/"
		expect(parseSetCookie("foo=bar; Path=", "acme.com", "/")?.path).toBe("/");
		expect(parseSetCookie("foo=bar; Path=oops", "acme.com", "/")?.path).toBe("/");
	});

	it("uses the last Path attribute when multiple are present (RFC 6265 §5.2.4 storage)", () => {
		// Last Path is invalid → resets to default-path even though an earlier valid Path exists
		expect(
			parseSetCookie("foo=bar; Path=/admin; Path=oops", "acme.com", "/account/login")?.path,
		).toBe("/account");
		// Last Path is valid → wins over earlier invalid Path
		expect(
			parseSetCookie("foo=bar; Path=oops; Path=/admin", "acme.com", "/account/login")?.path,
		).toBe("/admin");
		// Both valid → last wins
		expect(
			parseSetCookie("foo=bar; Path=/admin; Path=/billing", "acme.com", "/account/login")?.path,
		).toBe("/billing");
	});
});

function sessionWith(...cookies: FetchSession["cookies"]): FetchSession {
	return {
		id: "s",
		createdAt: "",
		lastUsedAt: "",
		cookies,
	};
}

describe("buildCookieHeader", () => {
	it("sends host-only cookie to same host", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			hostOnly: true,
			path: "/",
		});
		expect(buildCookieHeader(session, "acme.com", "/", "https")).toBe("foo=bar");
	});

	it("does NOT send host-only cookie to different host", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			hostOnly: true,
			path: "/",
		});
		expect(buildCookieHeader(session, "evil.com", "/", "https")).toBe("");
	});

	it("does NOT send host-only cookie to subdomain", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			hostOnly: true,
			path: "/",
		});
		expect(buildCookieHeader(session, "sub.acme.com", "/", "https")).toBe("");
	});

	it("sends domain-scoped cookie to exact host", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "example.com",
			path: "/",
		});
		expect(buildCookieHeader(session, "example.com", "/", "https")).toBe("foo=bar");
	});

	it("sends domain-scoped cookie to subdomain", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "example.com",
			path: "/",
		});
		expect(buildCookieHeader(session, "sub.example.com", "/", "https")).toBe("foo=bar");
	});

	it("does NOT send domain-scoped cookie to suffix-match host", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "example.com",
			path: "/",
		});
		expect(buildCookieHeader(session, "badexample.com", "/", "https")).toBe("");
		expect(buildCookieHeader(session, "notexample.com", "/", "https")).toBe("");
	});

	it("sends Secure cookie over https", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			secure: true,
			path: "/",
		});
		expect(buildCookieHeader(session, "acme.com", "/", "https")).toBe("foo=bar");
	});

	it("does NOT send Secure cookie over http", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			secure: true,
			path: "/",
		});
		expect(buildCookieHeader(session, "acme.com", "/", "http")).toBe("");
	});

	it("sends path-scoped cookie to matching path", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			path: "/api",
		});
		expect(buildCookieHeader(session, "acme.com", "/api/v1", "https")).toBe("foo=bar");
	});

	it("does NOT send path-scoped cookie to boundary-violating path", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			path: "/api",
		});
		expect(buildCookieHeader(session, "acme.com", "/apidocs", "https")).toBe("");
		expect(buildCookieHeader(session, "acme.com", "/api-private", "https")).toBe("");
	});

	it("sends path-scoped cookie when path ends with slash", () => {
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			path: "/api/",
		});
		expect(buildCookieHeader(session, "acme.com", "/api/v1", "https")).toBe("foo=bar");
	});

	it("excludes expired cookies", () => {
		const past = new Date(Date.now() - 86_400_000).toUTCString();
		const session = sessionWith({
			name: "foo",
			value: "bar",
			domain: "acme.com",
			path: "/",
			expires: past,
		});
		expect(buildCookieHeader(session, "acme.com", "/", "https")).toBe("");
	});
});

describe("updateSessionCookies", () => {
	it("deduplicates by name+domain+hostOnly+path", () => {
		const session: FetchSession = {
			id: "s",
			createdAt: "",
			lastUsedAt: "",
			cookies: [],
		};
		updateSessionCookies(session, ["foo=old; Domain=acme.com; Path=/"], "acme.com", "/");
		expect(session.cookies).toHaveLength(1);
		expect(session.cookies[0]?.value).toBe("old");

		updateSessionCookies(session, ["foo=new; Domain=acme.com; Path=/"], "acme.com", "/");
		expect(session.cookies).toHaveLength(1);
		expect(session.cookies[0]?.value).toBe("new");
	});

	it("keeps distinct hostOnly and domain-scoped cookies separate", () => {
		const session: FetchSession = {
			id: "s",
			createdAt: "",
			lastUsedAt: "",
			cookies: [],
		};
		// Host-only (no Domain attribute)
		updateSessionCookies(session, ["foo=host"], "acme.com", "/");
		// Domain-scoped
		updateSessionCookies(session, ["foo=domain; Domain=acme.com"], "acme.com", "/");
		expect(session.cookies).toHaveLength(2);
	});

	it("rejects cross-origin Domain attribute during update", () => {
		const session: FetchSession = {
			id: "s",
			createdAt: "",
			lastUsedAt: "",
			cookies: [],
		};
		updateSessionCookies(session, ["sid=x; Domain=victim.com"], "attacker.com", "/");
		expect(session.cookies).toHaveLength(0);
	});

	it("threads request path into default-path for cookies without Path", () => {
		const session: FetchSession = {
			id: "s",
			createdAt: "",
			lastUsedAt: "",
			cookies: [],
		};
		updateSessionCookies(session, ["foo=bar"], "acme.com", "/account/login");
		expect(session.cookies).toHaveLength(1);
		expect(session.cookies[0]?.path).toBe("/account");
	});
});

describe("mergeSessionHeaders", () => {
	it("returns plain headers when no session", () => {
		const result = mergeSessionHeaders(undefined, "acme.com", "/", "https", { "x-test": "yes" });
		expect(result["x-test"]).toBe("yes");
		expect(result["cookie"]).toBeUndefined();
	});

	it("merges session cookies with request headers", () => {
		const session: FetchSession = {
			id: "s",
			createdAt: "",
			lastUsedAt: "",
			cookies: [{ name: "sid", value: "abc", domain: "acme.com", hostOnly: true, path: "/" }],
			defaultHeaders: { accept: "text/html" },
		};
		const result = mergeSessionHeaders(session, "acme.com", "/", "https", { "x-test": "yes" });
		expect(result["accept"]).toBe("text/html");
		expect(result["x-test"]).toBe("yes");
		expect(result["cookie"]).toBe("sid=abc");
	});
});
