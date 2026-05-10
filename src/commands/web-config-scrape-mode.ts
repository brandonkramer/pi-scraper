/**
 * @fileoverview Scrape-mode sub-action for /web-config.
 *
 * Wraps the existing setDefaultMode handler from web-set-mode.ts.
 */
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.ts";
import { setDefaultMode } from "./web-set-mode.ts";
import { toolResult } from "../tools/infra/result.ts";
import type { CommandContext } from "./define.ts";
import type { Params } from "./web-config.ts";

export async function runWebConfigScrapeMode(
	params: Params,
	ctx?: CommandContext,
) {
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
				const picked = await ctx.ui.select(
					"Output format",
					[...OUTPUT_FORMATS],
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
				format = picked as (typeof OUTPUT_FORMATS)[number];
			}
		} else {
			return toolResult({
				text: "Interactive picker unavailable; use /web-config scrape-mode <mode> [format] directly.",
				data: { error: "no_picker" },
			});
		}
	}

	return setDefaultMode({ mode, format });
}
