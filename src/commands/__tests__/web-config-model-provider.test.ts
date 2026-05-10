/**
 * @fileoverview web-config-model-provider __tests__ module.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runWebConfigModelProvider } from "../web-config-model-provider.ts";

describe("runWebConfigModelProvider", () => {
	it("direct value sets config and reports", async () => {
		const rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-cmd-"));
		const result = await runWebConfigModelProvider(
			{ action: "model-provider", provider: "auto" },
			{},
			{ rootDir },
		);
		expect(result.content[0]?.text).toContain("auto");
		await rm(rootDir, { recursive: true, force: true });
	});

	it("picker selects off and reports", async () => {
		const rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-cmd-"));
		const ctx = {
			ui: {
				notify() {},
				async select(_title: string, choices: readonly string[]) {
					return choices.find((c) => c === "Off");
				},
			},
		};
		const result = await runWebConfigModelProvider(
			{ action: "model-provider" },
			ctx,
			{ rootDir },
		);
		expect(result.content[0]?.text).toContain("off");
		await rm(rootDir, { recursive: true, force: true });
	});

	it("no picker returns error hint", async () => {
		const result = await runWebConfigModelProvider(
			{ action: "model-provider" },
			{},
		);
		expect(result.content[0]?.text).toContain("Interactive picker unavailable");
	});
});
