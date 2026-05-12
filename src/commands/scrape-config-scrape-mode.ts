/**
 * @file Scrape-mode sub-action for /scrape-config. Handles interactive picker and persists the
 *   selected mode and format.
 */
import { type Static, StringEnum, Type } from "@earendil-works/pi-ai";

import { type ConfigOptions, type WebConfig, updateConfig } from "../config/settings.ts";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.ts";
import { toolResult } from "../tools/infra/result.ts";
import type { CommandContext } from "./define.ts";
import type { Params } from "./scrape-config.ts";

export const webSetModeSchema = Type.Object({
	mode: Type.Optional(StringEnum(SCRAPE_MODES, { description: "Default scrape mode." })),
	format: Type.Optional(
		StringEnum(OUTPUT_FORMATS, {
			description: "Optional default output format.",
		}),
	),
	scrapeDefaults: Type.Optional(Type.Unknown({ description: "Advanced scrape defaults." })),
});

type SetModeParams = Static<typeof webSetModeSchema>;

export async function setDefaultMode(params: SetModeParams, options: ConfigOptions = {}) {
	const patch: WebConfig = {
		scrapeMode: params.mode,
		outputFormat: params.format,
		scrapeDefaults: params.scrapeDefaults as WebConfig["scrapeDefaults"],
	};
	const config = await updateConfig(patch, options);
	return toolResult({
		text: `Web defaults saved: ${config.scrapeMode} (${config.outputFormat}), ${Object.keys(config.scrapeDefaults).length} advanced option(s).`,
		data: config,
		format: "json",
	});
}

export async function runScrapeConfigScrapeMode(params: Params, ctx?: CommandContext) {
	let mode = params.mode as (typeof SCRAPE_MODES)[number] | undefined;
	let format = params.format as (typeof OUTPUT_FORMATS)[number] | undefined;

	if (!mode || !format) {
		if (ctx?.ui?.select) {
			if (!mode) {
				const picked = await ctx.ui.select("Scrape mode", [...SCRAPE_MODES], {
					signal: ctx.signal,
				});
				if (!picked) {
					return toolResult({
						text: "Cancelled.",
						data: { cancelled: true },
					});
				}
				mode = picked as (typeof SCRAPE_MODES)[number];
			}
			if (!format) {
				const picked = await ctx.ui.select("Output format", [...OUTPUT_FORMATS], {
					signal: ctx.signal,
				});
				if (!picked) {
					return toolResult({
						text: "Cancelled.",
						data: { cancelled: true },
					});
				}
				format = picked as (typeof OUTPUT_FORMATS)[number];
			}
		} else {
			return toolResult({
				text: "Interactive picker unavailable; use /scrape-config scrape-mode <mode> [format] directly.",
				data: { error: "no_picker" },
			});
		}
	}

	return await setDefaultMode({ mode, format });
}
