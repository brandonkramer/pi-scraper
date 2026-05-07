import { type Static, Type } from "@mariozechner/pi-ai";
import { searchStoredScrapes } from "../storage/search.js";
import type { AgenticNextAction, AgenticQualitySignals } from "../types.js";
import {
	narrowSearchAction,
	retrieveResultAction,
	sourceNote,
	storedResultGuidance,
	truncateInline,
} from "./agentic-context.js";
import { defineWebTool } from "./define.js";
import { renderSimpleCall } from "./render.js";
import { renderWebSearchScrapesResult } from "./web-renderers.js";
import { toolResult } from "./result.js";

export const webSearchScrapesSchema = Type.Object({
	query: Type.String({
		description: "FTS query over stored scrape text.",
	}),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 10 })),
});

type Params = Static<typeof webSearchScrapesSchema>;

type SearchResult = Awaited<ReturnType<typeof searchStoredScrapes>>;

export const webSearchScrapesTool = defineWebTool({
	name: "web_search_scrapes",
	label: "Web Search Scrapes",
	description:
		"Search text of stored scrapes; returns unsupported stub if FTS5 unavailable.",
	parameters: webSearchScrapesSchema,
	async execute(_toolCallId, params: Params) {
		const result = await searchStoredScrapes(params.query, {
			limit: params.limit ?? 10,
		});
		const shaped = shapeSearchResult(params.query, result, params.limit ?? 10);
		return toolResult({
			text: shaped.text,
			data: {
				...result,
				query: params.query,
				limit: params.limit ?? 10,
			},
			format: "json",
			contentType: "application/json",
			...shaped.context,
		});
	},
	renderCall: (args, theme) =>
		renderSimpleCall("web_search_scrapes", [args.query], theme),
	renderResult: (result, { expanded }) =>
		renderWebSearchScrapesResult(result, expanded),
});

function shapeSearchResult(query: string, result: SearchResult, limit: number) {
	if (!result.supported) {
		const text =
			"Stored scrape full-text search is unavailable in this Node SQLite build.";
		return {
			text,
			context: {
				summary: text,
				answerContext: `Search for "${query}" could not run because FTS5 is unavailable. Use web_history for exact URLs or scrape relevant pages first.`,
				qualitySignals: {
					confidence: "high",
					freshness: "unknown",
					coverage: "partial",
					knownGaps: [result.reason ?? "FTS5 is unavailable."],
				} satisfies AgenticQualitySignals,
				nextActions: [
					narrowSearchAction(
						"Use an exact URL with web_history or scrape pages before searching stored text.",
					),
				],
				assistantGuidance: storedResultGuidance(),
			},
		};
	}
	if (result.hits.length === 0) {
		const text = `No stored scrape hits for "${query}".`;
		return {
			text,
			context: {
				summary: text,
				answerContext: `No stored markdown/text matched "${query}". Search coverage only includes pages already stored in pi-scraper's local index.`,
				qualitySignals: {
					confidence: "high",
					freshness: "unknown",
					coverage: "complete",
				} satisfies AgenticQualitySignals,
				nextActions: [
					narrowSearchAction(
						"Try a different stored-text query or scrape relevant pages first.",
					),
				],
				assistantGuidance: storedResultGuidance(),
			},
		};
	}
	const top = result.hits[0]!;
	const text = `Found ${result.hits.length} stored scrape hit(s) for "${query}". Top hit: ${top.title ?? top.url} — "${truncateInline(top.snippet, 140)}"`;
	return {
		text,
		context: {
			summary: text,
			answerContext: searchAnswerContext(query, result),
			sourceNotes: result.hits.slice(0, 3).map((hit, index) =>
				sourceNote({
					id: `s${index + 1}`,
					title: hit.title,
					uri: hit.url,
					excerpt: truncateInline(hit.snippet, 240),
					relevance: `Stored scrape hit for query "${query}"; retrieve responseId ${hit.responseId} for full context.`,
					sourceType: "database",
				}),
			),
			qualitySignals: {
				confidence: "medium",
				freshness: "unknown",
				coverage: result.hits.length >= limit ? "top_n_only" : "complete",
				knownGaps: [
					"Search only covers locally stored scrape text, not the live web.",
				],
			} satisfies AgenticQualitySignals,
			nextActions: searchNextActions(result),
			assistantGuidance: storedResultGuidance(),
		},
	};
}

function searchAnswerContext(query: string, result: SearchResult): string {
	return [
		`Stored scrape search results for "${query}":`,
		...result.hits
			.slice(0, 3)
			.map(
				(hit, index) =>
					`${index + 1}. ${hit.title ?? hit.url} (${hit.url}) — responseId ${hit.responseId}: ${truncateInline(hit.snippet, 220)}`,
			),
		"Use web_get_result for full stored content before making detailed claims.",
	].join("\n");
}

function searchNextActions(result: SearchResult): AgenticNextAction[] {
	return [
		...result.hits
			.slice(0, 3)
			.map((hit) =>
				retrieveResultAction(
					hit.responseId,
					`Retrieve full stored scrape for ${hit.title ?? hit.url}.`,
				),
			),
		narrowSearchAction(),
	];
}
