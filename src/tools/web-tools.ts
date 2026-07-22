/** @file Deferred discovery and activation for specialized pi-scraper tools. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import { defineWebTool } from "./infra/define.ts";
import { toolResult } from "./infra/result.ts";

export const WEB_TOOL_LOADER_NAME = "web_tools" as const;

export const deferredWebToolNames = [
	"web_crawl",
	"web_map",
	"web_batch",
	"web_get_result",
	"web_browser",
] as const;

type DeferredWebToolName = (typeof deferredWebToolNames)[number];

const deferredWebToolNameSet = new Set<string>(deferredWebToolNames);
const ignoredSearchTerms = new Set([
	"a",
	"an",
	"and",
	"for",
	"need",
	"the",
	"to",
	"tool",
	"tools",
	"use",
	"web",
]);

const searchTerms: Record<DeferredWebToolName, string> = {
	web_crawl: "crawl site linked pages depth resume crawl id status",
	web_map: "map discover urls robots sitemap sitemaps llms no page bodies",
	web_batch: "batch many urls parallel independent per url",
	web_get_result: "retrieve response id job id manifest stored result snapshot crawl batch",
	web_browser:
		"browser interactive live page navigate click fill select read screenshot evaluate session",
};

export const webToolsLoaderSchema = Type.Object({
	query: Type.String({
		description: "Capability to find: crawl, map, batch, stored result, or live browser",
	}),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: deferredWebToolNames.length })),
});

type Params = Static<typeof webToolsLoaderSchema>;

type DeferredToolAPI = Pick<ExtensionAPI, "getActiveTools" | "getAllTools" | "setActiveTools">;

export function createWebToolsLoader(pi: DeferredToolAPI) {
	return defineWebTool({
		name: WEB_TOOL_LOADER_NAME,
		label: "Web tools",
		description:
			"Find and activate specialized web tools for crawling linked pages, mapping robots/sitemaps, processing URL batches, retrieving stored jobs/results, or interacting with a live browser page.",
		promptSnippet:
			"Use web_tools to find specialized crawl, map, batch, result, or live-browser tools",
		promptGuidelines: [
			"Use web_tools when the task needs a specialized web capability that is not currently active.",
		],
		parameters: webToolsLoaderSchema,
		async execute(_toolCallId, params: Params) {
			const matches = searchDeferredTools(pi, params.query, params.limit ?? 1);
			if (matches.length === 0) {
				return toolResult({
					text: `No specialized pi-scraper tools matched: ${params.query}`,
					data: { matches, added: [] },
					summary: "No deferred web tools matched the requested capability.",
				});
			}

			const active = pi.getActiveTools();
			const added = matches.filter((name) => !active.includes(name));
			if (added.length > 0) pi.setActiveTools([...new Set([...active, ...added])]);

			return toolResult({
				text:
					added.length > 0
						? `Loaded specialized web tools: ${added.join(", ")}`
						: `Matching web tools are already active: ${matches.join(", ")}`,
				data: { matches, added },
				summary: `${String(added.length)} specialized web tool(s) activated.`,
			});
		},
	});
}

export function configureInitialWebTools(
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
): void {
	const initial = pi.getActiveTools().filter((name) => !deferredWebToolNameSet.has(name));
	pi.setActiveTools([...new Set([...initial, WEB_TOOL_LOADER_NAME])]);
}

function searchDeferredTools(
	pi: Pick<ExtensionAPI, "getAllTools">,
	query: string,
	limit: number,
): DeferredWebToolName[] {
	const terms = words(query);
	if (terms.length === 0) return [];

	return pi
		.getAllTools()
		.filter((tool): tool is typeof tool & { name: DeferredWebToolName } =>
			deferredWebToolNameSet.has(tool.name),
		)
		.map((tool) => ({
			name: tool.name,
			score: scoreTerms(terms, `${tool.name} ${tool.description} ${searchTerms[tool.name]}`),
		}))
		.filter((match) => match.score > 0)
		.toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name))
		.slice(0, Math.max(1, Math.min(limit, deferredWebToolNames.length)))
		.map((match) => match.name);
}

function words(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/u)
		.filter((term) => term.length > 0 && !ignoredSearchTerms.has(term));
}

function scoreTerms(terms: string[], searchable: string): number {
	const haystack = searchable.toLowerCase();
	return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}
