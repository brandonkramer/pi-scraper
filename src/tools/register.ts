import type { PiToolRegistrar, WebTool } from "./define.js";
import { webBatchTool } from "./web-batch.js";
import { webBrandTool } from "./web-brand.js";
import { webCrawlTool } from "./web-crawl.js";
import { webDiffTool } from "./web-diff.js";
import { webExtractTool } from "./web-extract.js";
import { webGetResultTool } from "./web-get-result.js";
import { webListExtractorsTool } from "./web-list-extractors.js";
import { webMapTool } from "./web-map.js";
import { webScrapeTool } from "./web-scrape.js";
import { webSummarizeTool } from "./web-summarize.js";
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
	for (const tool of webTools) {
		pi.registerTool(tool);
	}
}
