import { Type, type Static } from "@mariozechner/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { discoverSiteUrls } from "../map/discover.js";
import { storeResult } from "../storage/results.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { urlProperty } from "./schemas.js";

export const webMapSchema = Type.Object({
	url: urlProperty(),
	maxSitemaps: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
});

type Params = Static<typeof webMapSchema>;

export const webMapTool = defineWebTool({
	name: "web_map",
	label: "Map",
	description:
		"URLs from robots/sitemaps/llms.txt; does not fetch page content.",
	parameters: webMapSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const config = await loadEffectiveConfig();
		await emitProgress(onUpdate, {
			state: "loading",
			url: params.url,
			message: "discovering robots/sitemaps/llms",
		});
		const map = await discoverSiteUrls(
			params.url,
			{
				cacheTtlSeconds: config.scrapeDefaults.cacheTtlSeconds,
				maxAgeSeconds: config.scrapeDefaults.maxAgeSeconds,
				refresh: config.scrapeDefaults.refresh,
				...params,
			},
			{},
			signal,
		);
		const metadata = await storeResult(map);
		await emitProgress(onUpdate, {
			state: "done",
			url: params.url,
			current: map.urls.length,
			message: "map complete",
		});
		return toolResult({
			text: `Mapped ${map.urls.length} URL(s) from ${map.sitemaps.length} sitemap candidate(s). responseId: ${metadata.responseId}`,
			data: map,
			url: params.url,
			responseId: metadata.responseId,
			fullOutputPath: metadata.fullOutputPath,
			truncated: map.urls.length > 50,
		});
	},
	renderCall: (args, theme) => renderSimpleCall("web_map", [args.url], theme),
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
});
