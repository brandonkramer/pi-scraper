/** @file Tools register module. */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { webBatchTool } from "../web-batch.ts";
import { webCrawlTool } from "../web-crawl.ts";
import { webExtractTool } from "../web-extract.ts";
import { webGetResultTool } from "../web-get-result.ts";
import { webMapTool } from "../web-map.ts";
import { webScrapeTool } from "../web-scrape.ts";
import type { PiToolRegistrar, WebTool } from "./define.ts";
import { initModelAdapterProtocol } from "./model-registry.ts";

export const webTools: readonly WebTool[] = [
	webScrapeTool,
	webCrawlTool,
	webMapTool,
	webBatchTool,
	webExtractTool,
	webGetResultTool,
];

export async function registerWebTools(pi: ExtensionAPI | PiToolRegistrar): Promise<void> {
	initModelAdapterProtocol(pi);
	for (const tool of webTools) {
		// ExtensionAPI.registerTool expects ToolDefinition; our WebTools are valid
		// at runtime but not structurally assignable due to renderCall/theme differences.
		(pi as ExtensionAPI).registerTool(tool as unknown as ToolDefinition);
	}
}
