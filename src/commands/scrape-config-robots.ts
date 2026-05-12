/** @file Robots sub-action for /scrape-config. */
import { loadEffectiveConfig, updateConfig, type ConfigOptions } from "../config/settings.ts";
import { toolResult } from "../tools/infra/result.ts";
import type { CommandContext } from "./define.ts";
import type { Params } from "./scrape-config.ts";

export async function runScrapeConfigRobots(
	params: Params,
	ctx?: CommandContext,
	configOptions: ConfigOptions = {},
) {
	const config = await loadEffectiveConfig(configOptions);
	const current = config.scrapeDefaults.respectRobots ?? true;

	let value: boolean;
	if (params.value === "on") {
		value = true;
	} else if (params.value === "off") {
		value = false;
	} else {
		value = !current;
	}

	if (!value) {
		// Disabling robots requires confirmation
		if (ctx?.ui?.confirm) {
			const confirmed = await ctx.ui.confirm(
				"Disable robots compliance",
				"Disable robots.txt compliance? This may violate site policies.",
				{ signal: ctx.signal },
			);
			if (!confirmed) {
				return toolResult({
					text: "Robots setting unchanged.",
					data: { respectRobots: current },
				});
			}
		} else if (!params.force) {
			return toolResult({
				text: "Headless invocation requires explicit --force to disable robots compliance.",
				data: { error: "needs_force" },
			});
		}
	}

	const updated = await updateConfig(
		{
			scrapeDefaults: { respectRobots: value },
		},
		configOptions,
	);
	return toolResult({
		text: `Robots compliance ${value ? "enabled" : "disabled"}.`,
		data: { respectRobots: value, config: updated },
	});
}
