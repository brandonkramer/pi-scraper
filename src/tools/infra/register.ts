/**
 * @fileoverview tools register module.
 */
import type { PiToolRegistrar, WebTool } from "./define.ts";
import { initModelAdapterProtocol } from "./model-registry.ts";
import { resolveToolModelAdapter } from "./model-adapter.ts";
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

export function registerWebTools(pi: PiToolRegistrar): void {
	initModelAdapterProtocol(pi);
	const modelAdapter = resolveToolModelAdapter(pi);
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
		pi.registerTool(tool);
	}
}
