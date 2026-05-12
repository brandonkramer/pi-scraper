/** @file Tools register module. */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { loadEffectiveConfig } from "../../config/settings.ts";
import { webBatchTool } from "../web-batch.ts";
import { webCrawlTool } from "../web-crawl.ts";
import { webDiffTool } from "../web-diff.ts";
import { webExtractTool } from "../web-extract.ts";
import { webGetResultTool } from "../web-get-result.ts";
import { webMapTool } from "../web-map.ts";
import { webScrapeTool } from "../web-scrape.ts";
import { webSummarizeTool } from "../web-summarize.ts";
import type { PiToolRegistrar, WebTool } from "./define.ts";
import { initModelAdapterProtocol } from "./model-registry.ts";

export const webTools: readonly WebTool[] = [
	webScrapeTool,
	webSummarizeTool,
	webCrawlTool,
	webMapTool,
	webBatchTool,
	webDiffTool,
	webExtractTool,
	webGetResultTool,
];

export async function registerWebTools(pi: ExtensionAPI | PiToolRegistrar): Promise<void> {
	initModelAdapterProtocol(pi);
	const config = await loadEffectiveConfig();
	const hideModelBacked = config.modelProvider === "off";
	for (const tool of webTools) {
		if (hideModelBacked && tool.name === "web_summarize") {
			continue;
		}
		// ExtensionAPI.registerTool expects ToolDefinition; our WebTools are valid
		// at runtime but not structurally assignable due to renderCall/theme differences.
		(pi as ExtensionAPI).registerTool(tool as unknown as ToolDefinition);
	}
}
