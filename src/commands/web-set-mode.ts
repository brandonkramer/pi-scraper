import { type Static, StringEnum, Type } from "@mariozechner/pi-ai";
import { type ConfigOptions, updateConfig } from "../config/settings.js";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.js";
import { toolResult } from "../tools/result.js";
import { defineWebCommand } from "./define.js";

export const webSetModeSchema = Type.Object({
	mode: StringEnum(SCRAPE_MODES, { description: "Default scrape mode." }),
	format: Type.Optional(
		StringEnum(OUTPUT_FORMATS, {
			description: "Optional default output format.",
		}),
	),
});

type Params = Static<typeof webSetModeSchema>;

export async function setDefaultMode(
	params: Params,
	options: ConfigOptions = {},
) {
	const config = await updateConfig(
		{ scrapeMode: params.mode, outputFormat: params.format },
		options,
	);
	return toolResult({
		text: `Default web scrape mode set to ${config.scrapeMode}${params.format ? ` (${config.outputFormat})` : ""}.`,
		data: config,
		format: "json",
	});
}

export const webSetModeCommand = defineWebCommand({
	name: "web-set-mode",
	description:
		"Set persisted defaults for web scraping mode and optional output format.",
	parameters: webSetModeSchema,
	parseArgs: parseSetModeArgs,
	execute: (params) => setDefaultMode(params),
});

function parseSetModeArgs(args: string): Params {
	const trimmed = args.trim();
	if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Params;
	const [mode, format] = trimmed.split(/\s+/).filter(Boolean);
	if (!mode) throw new Error("Usage: /web-set-mode <mode> [format]");
	return { mode: mode as Params["mode"], format: format as Params["format"] };
}
