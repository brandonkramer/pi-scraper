/** @file Health **tests** session-start.test module. */
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { registerSessionStartHealthChecks, runSessionStartHealthChecks } from "../health.ts";

describe("session-start health checks", () => {
	it("registers a non-blocking session_start listener", async () => {
		const warnings: string[] = [];
		type SessionStartHandler = (
			event: SessionStartEvent,
			context: ExtensionContext,
		) => void | Promise<void>;
		let handler: SessionStartHandler | undefined;
		registerSessionStartHealthChecks(
			{
				on: (_event: "session_start", cb: SessionStartHandler) => {
					handler = cb;
				},
			} as unknown as ExtensionAPI,
			{ checkPlaywright: async () => false },
		);

		const context = {
			ui: {
				notify: (message: string) => warnings.push(message),
			},
		} as unknown as ExtensionContext;
		const result = handler?.({ type: "session_start", reason: "startup" }, context);
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
