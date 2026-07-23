/** @file Tests for browser storage-state session persistence. */
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	cleanupExpiredBrowserSessions,
	deleteBrowserSessionStorageState,
	deleteCloakSessionProfile,
	loadBrowserSessionStorageState,
	resolveBrowserSessionStoragePath,
	resolveCloakSessionProfilePath,
	saveBrowserSessionStorageState,
	validateSessionId,
} from "../session.ts";

let rootDir: string;
let originalStorageRoot: string | undefined;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-session-"));
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
	await rm(rootDir, { recursive: true, force: true });
});

describe("validateSessionId", () => {
	it("accepts safe session IDs", () => {
		expect(() => validateSessionId("abc-123")).not.toThrow();
		expect(() => validateSessionId("my_session")).not.toThrow();
	});

	it("rejects path traversal", () => {
		expect(() => validateSessionId(".")).toThrow("Invalid sessionId: .");
		expect(() => validateSessionId("..")).toThrow("Invalid sessionId: ..");
		expect(() => validateSessionId("foo/../bar")).toThrow("Invalid sessionId");
		expect(() => validateSessionId("foo\\bar")).toThrow("Invalid sessionId");
	});
});

describe("resolveBrowserSessionStoragePath", () => {
	it("returns a path under ~/.pi/scraper/sessions", () => {
		const p = resolveBrowserSessionStoragePath("abc-123");
		expect(p).toContain("sessions");
		expect(p).toContain("abc-123");
		expect(p.endsWith("storage.json")).toBe(true);
	});

	it("url-encodes special characters", () => {
		const p = resolveBrowserSessionStoragePath("a:b");
		expect(p).toContain("a%3Ab");
	});
});

describe("resolveCloakSessionProfilePath", () => {
	it("returns a path under ~/.pi/scraper/sessions", () => {
		const p = resolveCloakSessionProfilePath("abc-123");
		expect(p).toContain("sessions");
		expect(p).toContain("abc-123");
		expect(p.endsWith("cloak-profile")).toBe(true);
	});
});

describe("saveBrowserSessionStorageState", () => {
	it("writes storage state JSON to disk", async () => {
		const state = { cookies: [{ name: "x", value: "y" }], origins: [] };
		await saveBrowserSessionStorageState("test-session", state);
		const p = resolveBrowserSessionStoragePath("test-session");
		const data = await readFile(p, "utf-8");
		expect(JSON.parse(data)).toEqual(state);
	});

	it("creates parent directories", async () => {
		await saveBrowserSessionStorageState("deep-nested", { cookies: [] });
		const p = resolveBrowserSessionStoragePath("deep-nested");
		const stats = await stat(p);
		expect(stats.isFile()).toBe(true);
	});

	it.skipIf(process.platform === "win32")("writes storage.json with 0o600 mode", async () => {
		await saveBrowserSessionStorageState("perms-test", { cookies: [] });
		const p = resolveBrowserSessionStoragePath("perms-test");
		const stats = await stat(p);
		expect(stats.mode & 0o777).toBe(0o600);
	});
});

describe("loadBrowserSessionStorageState", () => {
	it("returns undefined when file is missing", async () => {
		const loaded = await loadBrowserSessionStorageState("missing");
		expect(loaded).toBeUndefined();
	});

	it("round-trips saved state", async () => {
		const state = {
			cookies: [{ name: "s", value: "v" }],
			origins: [{ origin: "o", localStorage: [] }],
		};
		await saveBrowserSessionStorageState("round-trip", state);
		const loaded = await loadBrowserSessionStorageState("round-trip");
		expect(loaded).toEqual(state);
	});
});

describe("deleteBrowserSessionStorageState", () => {
	it("removes the storage file", async () => {
		await saveBrowserSessionStorageState("to-delete", { cookies: [] });
		await deleteBrowserSessionStorageState("to-delete");
		const loaded = await loadBrowserSessionStorageState("to-delete");
		expect(loaded).toBeUndefined();
	});

	it("does not throw when file is missing", async () => {
		await expect(deleteBrowserSessionStorageState("never-existed")).resolves.toBeUndefined();
	});
});

describe("cleanupExpiredBrowserSessions", () => {
	it("deletes sessions older than maxAgeDays", async () => {
		await saveBrowserSessionStorageState("old", { cookies: [] });
		await saveBrowserSessionStorageState("new", { cookies: [] });

		// Manually age the "old" file by touching its mtime
		const oldPath = resolveBrowserSessionStoragePath("old");
		const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		await writeFile(oldPath, await readFile(oldPath, "utf-8"));
		await utimes(oldPath, oldDate, oldDate);

		await cleanupExpiredBrowserSessions(7);
		expect(await loadBrowserSessionStorageState("old")).toBeUndefined();
		expect(await loadBrowserSessionStorageState("new")).toEqual({ cookies: [] });
	});

	it("deletes stale Cloak profiles", async () => {
		await saveBrowserSessionStorageState("cloak-old", { cookies: [] });
		const cloakDir = resolveCloakSessionProfilePath("cloak-old");
		await mkdir(cloakDir, { recursive: true });
		await writeFile(path.join(cloakDir, "prefs.json"), "{}");

		const oldPath = resolveBrowserSessionStoragePath("cloak-old");
		const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		await writeFile(oldPath, await readFile(oldPath, "utf-8"));
		await utimes(oldPath, oldDate, oldDate);

		await cleanupExpiredBrowserSessions(7);
		expect(await loadBrowserSessionStorageState("cloak-old")).toBeUndefined();
		await expect(stat(cloakDir)).rejects.toThrow(/ENOENT|no such file/iu);
	});
});

describe("deleteCloakSessionProfile", () => {
	it("removes the Cloak profile directory", async () => {
		const cloakDir = resolveCloakSessionProfilePath("to-delete");
		await mkdir(cloakDir, { recursive: true });
		await writeFile(path.join(cloakDir, "prefs.json"), "{}");
		await deleteCloakSessionProfile("to-delete");
		await expect(stat(cloakDir)).rejects.toThrow(/ENOENT|no such file/iu);
	});

	it("does not throw when directory is missing", async () => {
		await expect(deleteCloakSessionProfile("never-existed")).resolves.toBeUndefined();
	});
});
