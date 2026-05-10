/**
 * @fileoverview tools register module.
 */
import type { PiToolRegistrar, WebTool } from "./define.ts";
import { initModelAdapterProtocol } from "./model-registry.ts";
import { resolveToolModelAdapter } from "./model-adapter.ts";
import { loadEffectiveConfig } from "../../config/settings.ts";
import { webBatchTool } from "../web-batch.ts";
import { webCrawlTool } from "../web-crawl.ts";
import { webDiffTool } from "../web-diff.ts";
import { createWebExtractTool, webExtractTool } from "../web-extract.ts";
import { webGetResultTool } from "../web-get-result.ts";
import { webMapTool } from "../web-map.ts";
import { createWebScrapeTool, webScrapeTool } from "../web-scrape.ts";
import { createWebSummarizeTool, webSummarizeTool } from "../web-summarize.ts";

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

let _piHostAdapterAvailable = false;

export function piHostAdapterAvailable(): boolean {
	return _piHostAdapterAvailable;
}

export async function registerWebTools(pi: PiToolRegistrar): Promise<void> {
	initModelAdapterProtocol(pi);
	const config = await loadEffectiveConfig();
	const modelAdapter = resolveToolModelAdapter(pi);
	_piHostAdapterAvailable = modelAdapter !== undefined;
	const hideModelBacked = config.modelProvider === "off";
	const tools = modelAdapter
		? webTools.map((tool) => {
				if (tool.name === "web_scrape")
					return createWebScrapeTool({ modelAdapter });
				if (tool.name === "web_extract")
					return createWebExtractTool({ modelAdapter });
				if (tool.name === "web_summarize")
					return createWebSummarizeTool({ modelAdapter });
				return tool;
			})
		: webTools;
	for (const tool of tools) {
		if (hideModelBacked && tool.name === "web_summarize") {
			continue;
		}
		pi.registerTool(tool);
	}
}
