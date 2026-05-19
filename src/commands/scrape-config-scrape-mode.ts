/**
 * @file Scrape-mode sub-action for /scrape-config. Handles interactive picker and persists the
 *   selected mode and format.
 */
import { type Static, Type } from "typebox";

import { type ConfigOptions, type WebConfig, updateConfig } from "../config.ts";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.ts";
import { toolResult } from "../tools/infra/result.ts";
import { StringEnum } from "../types.ts";
import type { CommandContext } from "./define.ts";
import type { Params } from "./scrape-config.ts";

export const scrapeModeSchema = Type.Object({
	mode: Type.Optional(StringEnum(SCRAPE_MODES, { description: "Default scrape mode." })),
	format: Type.Optional(
		StringEnum(OUTPUT_FORMATS, {
			description: "Optional default output format.",
		}),
	),
	maxBytes: Type.Optional(
		Type.Integer({ description: "Default max bytes to fetch (e.g. 52428800 for 50 MB)." }),
	),
	scrapeDefaults: Type.Optional(Type.Unknown({ description: "Advanced scrape defaults." })),
});

type ScrapeModeParams = Static<typeof scrapeModeSchema>;

export async function persistScrapeDefaults(params: ScrapeModeParams, options: ConfigOptions = {}) {
	const extraDefaults: WebConfig["scrapeDefaults"] = {
		...(params.maxBytes !== undefined ? { maxBytes: params.maxBytes } : {}),
		...(params.scrapeDefaults as WebConfig["scrapeDefaults"]),
	};
	const patch: WebConfig = {
		scrapeMode: params.mode,
		outputFormat: params.format,
		scrapeDefaults: Object.keys(extraDefaults).length > 0 ? extraDefaults : undefined,
	};
	const config = await updateConfig(patch, options);
	return toolResult({
		text: `Scrape defaults saved: ${config.scrapeMode} (${config.outputFormat}), ${Object.keys(config.scrapeDefaults).length} advanced option(s).`,
		data: config,
		format: "json",
	});
}

const MAX_BYTES_PRESETS = [
	{ label: "10 MB (default)", value: 10 * 1024 * 1024 },
	{ label: "30 MB", value: 30 * 1024 * 1024 },
	{ label: "50 MB", value: 50 * 1024 * 1024 },
	{ label: "100 MB", value: 100 * 1024 * 1024 },
	{ label: "Unlimited (200 MB)", value: 200 * 1024 * 1024 },
] as const;

export async function runScrapeConfigScrapeMode(params: Params, ctx?: CommandContext) {
	let mode = params.mode as (typeof SCRAPE_MODES)[number] | undefined;
	let format = params.format as (typeof OUTPUT_FORMATS)[number] | undefined;
	let maxBytes = params.maxBytes;

	if (!mode || !format) {
		if (!ctx?.ui?.select) {
			return toolResult({
				text: "Interactive picker unavailable; use /scrape-config scrape-mode <mode> [format] [maxBytes] directly.",
				data: { error: "no_picker" },
			});
		}
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
		if (maxBytes === undefined) {
			const picked = await ctx.ui.select(
				"Max file size",
				MAX_BYTES_PRESETS.map((p) => p.label),
				{
					signal: ctx.signal,
				},
			);
			if (!picked) {
				return toolResult({
					text: "Cancelled.",
					data: { cancelled: true },
				});
			}
			const preset = MAX_BYTES_PRESETS.find((p) => p.label === picked);
			if (preset) maxBytes = preset.value;
		}
	}

	return await persistScrapeDefaults({ mode, format, maxBytes });
}
