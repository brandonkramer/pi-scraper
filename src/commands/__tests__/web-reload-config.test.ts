/** @file Web-reload-config **tests** module. */
import { describe, expect, it } from "vitest";

import { clearEffectiveConfigCache } from "../../config/settings.ts";
import { webReloadConfigCommand } from "../web-reload-config.ts";

describe("web-reload-config command", () => {
	it("reloads config and reports current values", async () => {
		clearEffectiveConfigCache();
		const result = await webReloadConfigCommand.execute({}, {});
		expect(result.content[0]?.text).toContain("Config reloaded");
		expect(result.content[0]?.text).toMatch(/mode=\w+/u);
		expect(result.content[0]?.text).toMatch(/format=\w+/u);
	});
});
