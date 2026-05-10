/**
 * @fileoverview Command adapter for persisted default web scrape settings.
 */
import { type Static, StringEnum, Type } from "@earendil-works/pi-ai";
import {
	type ConfigOptions,
	type WebConfig,
	updateConfig,
} from "../config/settings.ts";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.ts";
import { toolResult } from "../tools/result.ts";
import { defineWebCommand } from "./define.ts";

export const webSetModeSchema = Type.Object({
	mode: Type.Optional(
		StringEnum(SCRAPE_MODES, { description: "Default scrape mode." }),
	),
	format: Type.Optional(
		StringEnum(OUTPUT_FORMATS, {
			description: "Optional default output format.",
		}),
	),
	scrapeDefaults: Type.Optional(
		Type.Unknown({ description: "Advanced scrape defaults." }),
	),
});

type Params = Static<typeof webSetModeSchema>;

export async function setDefaultMode(
	params: Params,
	options: ConfigOptions = {},
) {
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

export const webSetModeCommand = defineWebCommand({
	name: "web-set-mode",
	description:
		"Set persisted web scrape defaults: mode, output format, and advanced scrape options.",
	parameters: webSetModeSchema,
	parseArgs: parseSetModeArgs,
	execute: (params) => setDefaultMode(params),
});

function parseSetModeArgs(args: string): Params {
	const trimmed = args.trim();
	if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Params;
	const [mode, format] = trimmed.split(/\s+/).filter(Boolean);
	if (!mode)
		throw new Error(
			"Usage: /web-set-mode <mode> [format] or JSON with scrapeDefaults",
		);
	return { mode: mode as Params["mode"], format: format as Params["format"] };
}
