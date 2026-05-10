/**
 * @fileoverview config __tests__ settings.test module.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	configFilePath,
	loadEffectiveConfig,
	loadStoredConfig,
	saveConfig,
	updateConfig,
} from "../settings.ts";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-config-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("web config settings", () => {
	it("loads scrape defaults when no persisted config exists", async () => {
		const config = await loadEffectiveConfig({ rootDir });
		expect(config.scrapeMode).toBe("auto");
		expect(config.outputFormat).toBe("markdown");
		expect(config.scrapeDefaults).toEqual({});
	});

	it("persists and merges scrape settings", async () => {
		await saveConfig(
			{ scrapeMode: "fast", scrapeDefaults: { timeoutSeconds: 5 } },
			{ rootDir },
		);
		await updateConfig(
			{ outputFormat: "text", scrapeDefaults: { maxBytes: 4096 } },
			{ rootDir },
		);
		const stored = await loadStoredConfig({ rootDir });
		const effective = await loadEffectiveConfig({ rootDir });
		expect(configFilePath({ rootDir })).toContain(path.join(rootDir, "config"));
		expect(stored.scrapeMode).toBe("fast");
		expect(effective.scrapeMode).toBe("fast");
		expect(effective.outputFormat).toBe("text");
		expect(effective.scrapeDefaults).toMatchObject({
			timeoutSeconds: 5,
			maxBytes: 4096,
		});
	});
});
