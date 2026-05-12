import { loadEffectiveConfig } from "../../config/settings.ts";
import { webBatchTool } from "../web-batch.ts";
import { webCrawlTool } from "../web-crawl.ts";
import { webDiffTool } from "../web-diff.ts";
import { webExtractTool } from "../web-extract.ts";
import { webGetResultTool } from "../web-get-result.ts";
import { webMapTool } from "../web-map.ts";
import { webScrapeTool } from "../web-scrape.ts";
import { webSummarizeTool } from "../web-summarize.ts";
/** @file Tools register module. */
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

export async function registerWebTools(pi: PiToolRegistrar): Promise<void> {
	initModelAdapterProtocol(pi);
	const config = await loadEffectiveConfig();
	const hideModelBacked = config.modelProvider === "off";
	for (const tool of webTools) {
		if (hideModelBacked && tool.name === "web_summarize") {
			continue;
		}
		pi.registerTool(tool);
	}
}
