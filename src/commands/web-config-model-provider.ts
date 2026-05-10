/**
 * @fileoverview Model-provider sub-action for /web-config.
 */
import { updateConfig, type ConfigOptions } from "../config/settings.ts";
import { modelRegistry } from "../tools/infra/model-registry.ts";
import { toolResult } from "../tools/infra/result.ts";
import type { CommandContext } from "./define.ts";
import type { Params } from "./web-config.ts";

export async function runWebConfigModelProvider(
	params: Params,
	ctx?: CommandContext,
	configOptions: ConfigOptions = {},
) {
	let provider = params.provider;

	if (!provider) {
		if (ctx?.ui?.select) {
			const choices = ["Auto", "Off", ...modelRegistry.list().map((e) => e.id)];
			const picked = await ctx.ui.select("Model provider", choices, {
				signal: ctx.signal,
			});
			if (!picked) {
				return toolResult({
					text: "Cancelled.",
					data: { cancelled: true },
				});
			}
			provider = picked === "Auto" ? "auto" : picked === "Off" ? "off" : picked;
		} else {
			return toolResult({
				text: "Interactive picker unavailable; use /web-config model-provider <value> directly.",
				data: { error: "no_picker" },
			});
		}
	}

	const updated = await updateConfig(
		{ modelProvider: provider },
		configOptions,
	);
	return toolResult({
		text: `Model provider set to "${updated.modelProvider}".`,
		data: updated,
	});
}
