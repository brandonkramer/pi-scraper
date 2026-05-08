/**
 * @fileoverview tools register module.
 */
import type { PiToolRegistrar, WebTool } from "./define.js";
import { resolveToolModelAdapter } from "./model-adapter.js";
import { webBatchTool } from "./web-batch.js";
import { webCrawlTool } from "./web-crawl.js";
import { webDiffTool } from "./web-diff.js";
import { createWebExtractTool, webExtractTool } from "./web-extract.js";
import { webGetResultTool } from "./web-get-result.js";
import { webMapTool } from "./web-map.js";
import { createWebScrapeTool, webScrapeTool } from "./web-scrape.js";
import { createWebSummarizeTool, webSummarizeTool } from "./web-summarize.js";

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
