import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** @file Web-config-robots **tests** module. */
import { describe, expect, it } from "vitest";

import { runScrapeConfigRobots } from "../scrape-config-robots.ts";

async function withTempDir<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
	const rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-cmd-"));
	try {
		return await fn(rootDir);
	} finally {
		await rm(rootDir, { recursive: true, force: true });
	}
}

describe("runScrapeConfigRobots", () => {
	it("enabling requires no confirmation", async () => {
		await withTempDir(async (rootDir) => {
			const result = await runScrapeConfigRobots(
				{ action: "robots", value: "on" },
				{},
				{ rootDir },
			);
			expect(result.content[0]?.text).toContain("enabled");
		});
	});

	it("disabling with declined confirm preserves value", async () => {
		await withTempDir(async (rootDir) => {
			const ctx = {
				ui: {
					notify() {
						/* no-op */
					},
					async confirm() {
						return false;
					},
				},
			};
			const result = await runScrapeConfigRobots({ action: "robots", value: "off" }, ctx, {
				rootDir,
			});
			expect(result.content[0]?.text).toContain("unchanged");
		});
	});

	it("disabling without picker requires --force", async () => {
		await withTempDir(async (rootDir) => {
			const result = await runScrapeConfigRobots(
				{ action: "robots", value: "off" },
				{},
				{ rootDir },
			);
			expect(result.content[0]?.text).toContain("--force");
		});
	});

	it("disabling with --force bypasses confirm", async () => {
		await withTempDir(async (rootDir) => {
			const result = await runScrapeConfigRobots(
				{ action: "robots", value: "off", force: true },
				{},
				{ rootDir },
			);
			expect(result.content[0]?.text).toContain("disabled");
		});
	});
});
