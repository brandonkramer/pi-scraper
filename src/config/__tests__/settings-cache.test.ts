/** @file Config settings cache **tests** module. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	clearEffectiveConfigCache,
	loadEffectiveConfig,
	reloadEffectiveConfig,
	saveConfig,
} from "../settings.ts";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-config-cache-"));
	clearEffectiveConfigCache();
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("loadEffectiveConfig cache", () => {
	it("caches the effective config across repeated calls", async () => {
		await saveConfig({ scrapeMode: "fast" }, { rootDir });
		const a = await loadEffectiveConfig({ rootDir });
		const b = await loadEffectiveConfig({ rootDir });
		expect(a.scrapeMode).toBe("fast");
		expect(b.scrapeMode).toBe("fast");
	});

	it("re-reads after clearEffectiveConfigCache", async () => {
		await saveConfig({ scrapeMode: "fast" }, { rootDir });
		const first = await loadEffectiveConfig({ rootDir });
		expect(first.scrapeMode).toBe("fast");

		await saveConfig({ scrapeMode: "browser" }, { rootDir });
		clearEffectiveConfigCache();
		const second = await loadEffectiveConfig({ rootDir });
		expect(second.scrapeMode).toBe("browser");
	});

	it("reloadEffectiveConfig clears and re-reads in one call", async () => {
		await saveConfig({ scrapeMode: "fast" }, { rootDir });
		await loadEffectiveConfig({ rootDir });

		await saveConfig({ scrapeMode: "browser" }, { rootDir });
		const reloaded = await reloadEffectiveConfig({ rootDir });
		expect(reloaded.scrapeMode).toBe("browser");
	});

	it("saveConfig invalidates the cache automatically", async () => {
		await saveConfig({ scrapeMode: "fast" }, { rootDir });
		const first = await loadEffectiveConfig({ rootDir });
		expect(first.scrapeMode).toBe("fast");

		await saveConfig({ scrapeMode: "browser" }, { rootDir });
		const second = await loadEffectiveConfig({ rootDir });
		expect(second.scrapeMode).toBe("browser");
	});

	it("does not cache a failed load (rejected Promise is evicted)", async () => {
		const filePath = path.join(rootDir, "config", "web.json");
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, "not valid json", { mode: 0o600 });

		await expect(loadEffectiveConfig({ rootDir })).rejects.toThrow("Unexpected token");

		// After rejection, the .catch() handler auto-evicts the cache entry.
		// Next call retries fresh and succeeds.
		await writeFile(filePath, JSON.stringify({ scrapeMode: "auto" }), { mode: 0o600 });
		const result = await loadEffectiveConfig({ rootDir });
		expect(result.scrapeMode).toBe("auto");
	});

	it("uses distinct cache entries for different paths", async () => {
		const rootDirA = rootDir;
		const rootDirB = await mkdtemp(path.join(tmpdir(), "pi-scraper-config-cache-b-"));

		await saveConfig({ scrapeMode: "fast" }, { rootDir: rootDirA });
		await saveConfig({ scrapeMode: "browser" }, { rootDir: rootDirB });

		const a = await loadEffectiveConfig({ rootDir: rootDirA });
		const b = await loadEffectiveConfig({ rootDir: rootDirB });
		expect(a.scrapeMode).toBe("fast");
		expect(b.scrapeMode).toBe("browser");

		await rm(rootDirB, { recursive: true, force: true });
	});
});
