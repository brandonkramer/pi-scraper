/**
 * @fileoverview Pi tool adapter for robots, sitemap, and llms.txt URL maps.
 */
import { Type, type Static } from "@earendil-works/pi-ai";
import { loadEffectiveConfig } from "../config/settings.ts";
import { discoverSiteUrls } from "../map/discover.ts";
import { storeResult } from "../storage/results.ts";
import { defineWebTool } from "./define.ts";
import { emitProgress } from "./progress.ts";
import { renderSimpleCall } from "../tui/simple-call.ts";
import { toolResult } from "./result.ts";
import { renderWebMapResult } from "./web-map-renderers.ts";
import { urlProperty } from "./schemas.ts";

export const webMapSchema = Type.Object({
	url: urlProperty(),
	maxSitemaps: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
});

type Params = Static<typeof webMapSchema>;

export const webMapTool = defineWebTool({
	name: "web_map",
	label: "Map",
	description: "URLs robots/sitemaps/llms no bodies",
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
	renderResult: (result, { expanded }, theme) =>
		renderWebMapResult(result, expanded, theme),
});
