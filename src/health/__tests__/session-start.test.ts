/** @file Health **tests** session-start.test module. */
import { describe, expect, it } from "vitest";

import { registerSessionStartHealthChecks, runSessionStartHealthChecks } from "../session-start.ts";

describe("session-start health checks", () => {
	it("registers a non-blocking session_start listener", async () => {
		const warnings: string[] = [];
		let handler: (() => void | Promise<void>) | undefined;
		registerSessionStartHealthChecks(
			{
				on: (_event, cb) => {
					handler = cb;
				},
				warn: (message) => warnings.push(message),
			},
			{ checkPlaywright: async () => false },
		);

		const result = handler?.();
		expect(result).toBeUndefined();
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
		expect(warnings[0]).toContain("PLAYWRIGHT_UNAVAILABLE");
	});

	it("only reports optional Playwright health after search providers moved out", async () => {
		const warnings = await runSessionStartHealthChecks({
			checkPlaywright: async () => true,
		});
		expect(warnings).toEqual([]);
	});
});
