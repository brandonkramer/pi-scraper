import type { PiToolRegistrar, WebTool } from "./define.js";
import { resolveToolModelAdapter } from "./model-adapter.js";
import { webBatchTool } from "./web-batch.js";
import { webBrandTool } from "./web-brand.js";
import { webCrawlTool } from "./web-crawl.js";
import { webDiffTool } from "./web-diff.js";
import { createWebExtractTool, webExtractTool } from "./web-extract.js";
import { webGetResultTool } from "./web-get-result.js";
import { webListExtractorsTool } from "./web-list-extractors.js";
import { webMapTool } from "./web-map.js";
import { webScrapeTool } from "./web-scrape.js";
import { createWebSummarizeTool, webSummarizeTool } from "./web-summarize.js";
import { webVerticalScrapeTool } from "./web-vertical-scrape.js";

export const webTools: readonly WebTool[] = [
	webScrapeTool,
	webCrawlTool,
	webMapTool,
	webBatchTool,
	webBrandTool,
	webDiffTool,
	webListExtractorsTool,
	webVerticalScrapeTool,
	webExtractTool,
	webSummarizeTool,
	webGetResultTool,
];

export function registerWebTools(pi: PiToolRegistrar): void {
	const modelAdapter = resolveToolModelAdapter(pi);
	const tools = modelAdapter
		? webTools.map((tool) => {
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
