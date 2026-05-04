import { type Static, Type } from "@mariozechner/pi-ai";
import { searchStoredScrapes } from "../storage/search.js";
import { defineWebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";

export const webSearchScrapesSchema = Type.Object({
	query: Type.String({
		description:
			"Full-text query over stored scrape text when FTS5 is available.",
	}),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 10 })),
});

type Params = Static<typeof webSearchScrapesSchema>;

export const webSearchScrapesTool = defineWebTool({
	name: "web_search_scrapes",
	label: "Web Search Scrapes",
	description:
		"Search stored scrape text when SQLite FTS5 support is available; returns a clean unsupported stub otherwise.",
	parameters: webSearchScrapesSchema,
	async execute(_toolCallId, params: Params) {
		const result = await searchStoredScrapes(params.query, {
			limit: params.limit ?? 10,
		});
		return toolResult({
			text: result.supported
				? `${result.hits.length} stored scrape hit(s).`
				: "Stored scrape full-text search is not supported in this Node build.",
			data: {
				...result,
				query: params.query,
				limit: params.limit ?? 10,
			},
			format: "json",
			contentType: "application/json",
		});
	},
	renderCall: (args, theme) =>
		renderSimpleCall("web_search_scrapes", [args.query], theme),
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
});
