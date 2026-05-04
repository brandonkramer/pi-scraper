import { Type, type Static } from "@mariozechner/pi-ai";
import { extractBrandIdentity } from "../brand/extract.js";
import { scrapeUrl } from "../scrape/pipeline.js";
import { qualityFromCache, storedResultGuidance } from "./agentic-context.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webBrandSchema = Type.Object({
	url: urlProperty("Site URL to inspect for brand identity."),
	manifestJson: Type.Optional(
		Type.String({
			description: "Optional Web App Manifest JSON if already available.",
		}),
	),
	...scrapeOptionSchema,
});

type Params = Static<typeof webBrandSchema>;

export const webBrandTool = defineWebTool({
	name: "web_brand",
	label: "Web Brand",
	description:
		"Extract brand identity from static HTML/CSS: colors, fonts, logos, favicons, manifests, JSON-LD, Open Graph, and Twitter assets. Browser optional only via mode.",
	parameters: webBrandSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		await emitProgress(onUpdate, {
			state: "loading",
			url: params.url,
			message: "scraping brand page",
		});
		const scraped = await scrapeUrl(
			params.url,
			{ ...params, format: "html", mode: params.mode ?? "fast" },
			{},
			signal,
		);
		if (scraped.error)
			return toolResult({
				text: `Brand scrape failed: ${scraped.error.message}`,
				data: undefined,
				url: params.url,
				error: scraped.error,
			});
		const brand = extractBrandIdentity(
			scraped.data.html ?? "",
			scraped.finalUrl ?? params.url,
			{ manifestJson: params.manifestJson },
		);
		const text = `Brand: ${brand.name ?? brand.url} · ${brand.colors.length} colors · ${brand.fonts.length} fonts · ${brand.assets.length} assets`;
		return toolResult({
			text,
			data: brand,
			url: params.url,
			finalUrl: scraped.finalUrl,
			mode: scraped.mode,
			format: "json",
			cache: scraped.cache,
			summary: text,
			answerContext: `${text}. Brand signals were extracted from ${scraped.cache?.cached ? "cached" : "freshly fetched"} page HTML for ${scraped.finalUrl ?? params.url}.`,
			qualitySignals: qualityFromCache(scraped.cache),
			assistantGuidance: storedResultGuidance(),
		});
	},
	renderCall: (args, theme) => renderSimpleCall("web_brand", [args.url], theme),
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
});
