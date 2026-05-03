import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEffectiveConfig } from "../../config/settings.js";
import type { ResultEnvelope } from "../../types.js";
import type { RegisteredCommandOptions } from "../define.js";
import { registerWebCommands, webCommands } from "../register.js";
import { setDefaultMode } from "../web-set-mode.js";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-commands-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("web command registration", () => {
	it("registers explicit configuration commands with Pi's two-argument API", () => {
		const registered: Array<{
			name: string;
			options: RegisteredCommandOptions;
		}> = [];
		registerWebCommands({
			registerCommand: (name, options) => registered.push({ name, options }),
		});
		expect(registered.map((command) => command.name)).toEqual(["web-set-mode"]);
		expect(registered[0]?.options.handler).toBeTypeOf("function");
		expect(
			webCommands.every((command) => command.name.startsWith("web-")),
		).toBe(true);
	});

	it("persists scrape mode defaults", async () => {
		const modeResult = await setDefaultMode({ mode: "fast" }, { rootDir });
		const config = await loadEffectiveConfig({ rootDir });
		expect((modeResult.details as ResultEnvelope).data).toBeTruthy();
		expect(config.scrapeMode).toBe("fast");
	});
});
