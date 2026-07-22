/** @file Tools register module. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { webBatchTool } from "../web-batch.ts";
import { webBrowserTool } from "../web-browser.ts";
import { webCrawlTool } from "../web-crawl.ts";
import { webExtractTool } from "../web-extract.ts";
import { webGetResultTool } from "../web-get-result.ts";
import { webMapTool } from "../web-map.ts";
import { webScrapeTool } from "../web-scrape.ts";
import {
	configureInitialWebTools,
	createWebToolsLoader,
	WEB_TOOL_LOADER_NAME,
} from "../web-tools.ts";
import {
	configureToolFlagReader,
	type PiToolRegistrar,
	toPiToolDefinition,
	type WebTool,
} from "./define.ts";
import { initModelAdapterProtocol } from "./model-registry.ts";

export const webTools: readonly WebTool[] = [
	webScrapeTool,
	webCrawlTool,
	webMapTool,
	webBatchTool,
	webExtractTool,
	webGetResultTool,
	webBrowserTool,
];

export async function registerWebTools(pi: ExtensionAPI | PiToolRegistrar): Promise<void> {
	initModelAdapterProtocol(pi);
	configureToolFlagReader((name) => {
		const value = pi.getFlag?.(name);
		return typeof value === "string" ? value : undefined;
	});
	if (!supportsDeferredToolLoading(pi)) {
		for (const tool of webTools) pi.registerTool(tool);
		return;
	}

	for (const tool of webTools) pi.registerTool(toPiToolDefinition(tool));
	pi.registerTool(toPiToolDefinition(createWebToolsLoader(pi)));
	pi.on("session_start", () => configureInitialWebTools(pi));
}

function supportsDeferredToolLoading(pi: ExtensionAPI | PiToolRegistrar): pi is ExtensionAPI {
	return (
		"getActiveTools" in pi &&
		typeof pi.getActiveTools === "function" &&
		"getAllTools" in pi &&
		typeof pi.getAllTools === "function" &&
		"setActiveTools" in pi &&
		typeof pi.setActiveTools === "function" &&
		"on" in pi &&
		typeof pi.on === "function"
	);
}

export const initialWebToolNames = ["web_scrape", "web_extract", WEB_TOOL_LOADER_NAME] as const;
