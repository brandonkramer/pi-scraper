/** @file /web reload-config command — clears config cache and re-reads from disk. */
import { reloadEffectiveConfig } from "../config/settings.ts";
import { toolResult } from "../tools/infra/result.ts";
import { defineWebCommand } from "./define.ts";

export const webReloadConfigCommand = defineWebCommand({
	name: "web-reload-config",
	description: "Reload persisted web config from disk, clearing the in-memory cache.",
	parameters: {},
	execute: async () => {
		const config = await reloadEffectiveConfig();
		return toolResult({
			text: `Config reloaded: mode=${config.scrapeMode}, format=${config.outputFormat}, ${Object.keys(config.scrapeDefaults).length} advanced option(s).`,
			data: config,
			format: "json",
		});
	},
});
