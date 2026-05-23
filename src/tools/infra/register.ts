/** @file Tools register module. */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { cleanupOldDownloads } from "../../http/download-storage.ts";
import { tryCreatePiAiAdapter } from "../../model-adapter/pi-ai-adapter.ts";
import { webBatchTool } from "../web-batch.ts";
import { webCrawlTool } from "../web-crawl.ts";
import { webExtractTool } from "../web-extract.ts";
import { webGetResultTool } from "../web-get-result.ts";
import { webMapTool } from "../web-map.ts";
import { webScrapeTool } from "../web-scrape.ts";
import type { PiToolRegistrar, WebTool } from "./define.ts";
import { initModelAdapterProtocol, modelRegistry } from "./model-registry.ts";

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
	// Fire-and-forget TTL cleanup for old downloads
	cleanupOldDownloads().catch(() => null);

	// Peer-optional pi-ai fallback adapter (env/config-pinned provider/model)
	const piAi = await tryCreatePiAiAdapter({
		provider: process.env.PI_AI_PROVIDER,
		model: process.env.PI_AI_MODEL,
	});
	if (piAi) {
		const piProvider = process.env.PI_AI_PROVIDER ?? "?";
		const piModel = process.env.PI_AI_MODEL ?? "?";
		modelRegistry.register({
			id: "pi-ai",
			label: `Pi AI (${piProvider}/${piModel})`,
			capabilities: ["summarize", "extract"],
			priority: 30,
			adapter: piAi,
		});
	}
}
