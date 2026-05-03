import { StringEnum, Type, type Static } from "@mariozechner/pi-ai";
import { SCRAPE_MODES, OUTPUT_FORMATS } from "../defaults.js";
import { updateConfig, type ConfigOptions } from "../config/settings.js";
import { toolResult } from "../tools/result.js";
import { defineWebCommand } from "./define.js";

export const webSetModeSchema = Type.Object({
  mode: StringEnum(SCRAPE_MODES, { description: "Default scrape mode." }),
  format: Type.Optional(StringEnum(OUTPUT_FORMATS, { description: "Optional default output format." })),
});

type Params = Static<typeof webSetModeSchema>;

export async function setDefaultMode(params: Params, options: ConfigOptions = {}) {
  const config = await updateConfig({ scrapeMode: params.mode, outputFormat: params.format }, options);
  return toolResult({ text: `Default web scrape mode set to ${config.scrapeMode}${params.format ? ` (${config.outputFormat})` : ""}.`, data: config, format: "json" });
}

export const webSetModeCommand = defineWebCommand({
  name: "web-set-mode",
  description: "Set persisted defaults for web scraping mode and optional output format.",
  parameters: webSetModeSchema,
  execute: (params) => setDefaultMode(params),
});
