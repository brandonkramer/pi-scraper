/**
 * @fileoverview http __tests__ session.test module.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deleteSessionAndStorage,
	getOrCreateSession,
	saveSessionToStorage,
} from "../session.ts";

let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-session-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
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
});
