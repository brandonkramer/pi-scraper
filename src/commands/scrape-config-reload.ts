/** @file Reload sub-action for /scrape-config. Clears config cache and re-reads from disk. */
import { reloadEffectiveConfig } from "../config/settings.ts";
import { toolResult } from "../tools/infra/result.ts";

export async function runScrapeConfigReload() {
	const config = await reloadEffectiveConfig();
	return toolResult({
		text: `Config reloaded: mode=${config.scrapeMode}, format=${config.outputFormat}, ${Object.keys(config.scrapeDefaults).length} advanced option(s).`,
		data: config,
		format: "json",
	});
}
