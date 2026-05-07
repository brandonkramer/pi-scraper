import { describe, expect, it } from "vitest";
import type { WebTool } from "../define.js";
import { webTools } from "../register.js";

const expectedNames = [
	"web_scrape",
	"web_crawl",
	"web_map",
	"web_batch",
	"web_brand",
	"web_diff",
	"web_list_extractors",
	"web_vertical_scrape",
	"web_extract",
	"web_summarize",
	"web_get_result",
	"web_history",
	"web_crawls",
	"web_search_scrapes",
] as const;

const perToolTokenCeilings: Record<(typeof expectedNames)[number], number> = {
	web_scrape: 360,
	web_crawl: 280,
	web_map: 180,
	web_batch: 180,
	web_brand: 180,
	web_diff: 180,
	web_list_extractors: 180,
	web_vertical_scrape: 190,
	web_extract: 180,
	web_summarize: 180,
	web_get_result: 180,
	web_history: 180,
	web_crawls: 180,
	web_search_scrapes: 180,
};

const scrapeOnlyFields = [
	"headers",
	"proxy",
	"respectRobots",
	"maxBytes",
	"maxChars",
	"browserProfile",
	"osProfile",
	"onlyMainContent",
	"removeImages",
] as const;

const configOnlyCacheFields = [
	"cacheTtlSeconds",
	"maxAgeSeconds",
	"refresh",
] as const;

const discriminatorChecks: Record<string, RegExp[]> = {
	web_scrape: [/fetch|extract/iu, /one URL/iu],
	web_crawl: [/crawl/iu, /linked pages/iu],
	web_map: [/robots\/sitemaps\/llms/iu, /does not fetch page content/iu],
	web_batch: [/independent URLs/iu, /per-URL/iu],
	web_brand: [/colors/iu, /fonts/iu, /logos/iu],
	web_diff: [/compare/iu, /snapshot/iu],
	web_vertical_scrape: [/deterministic|known-site/iu],
	web_extract: [/JSON\/schema/iu, /LLM/iu, /web_vertical_scrape|known-site/iu],
	web_summarize: [/one page|provided content/iu, /not multi-source research/iu],
	web_get_result: [/responseId/iu, /crawlId|snapshot/iu],
	web_history: [/prior local scrapes\/fetches/iu],
	web_crawls: [/prior local crawls/iu],
	web_search_scrapes: [/stored scrapes/iu, /FTS5/iu],
};

describe("web tool contracts", () => {
	it("exports exactly the stable public web tools", () => {
		expect(webTools.map((tool) => tool.name)).toEqual(expectedNames);
	});

	it("keeps serialized tool contracts inside token budgets", () => {
		const contractStats = webTools.map((tool) => ({
			name: tool.name,
			tokens: approximateTokens(serializeContract(tool).length),
		}));
		const totalTokens = contractStats.reduce(
			(total, stat) => total + stat.tokens,
			0,
		);

		expect(totalTokens).toBeLessThanOrEqual(2100);
		for (const stat of contractStats) {
			const name = stat.name as (typeof expectedNames)[number];
			expect(stat.tokens, stat.name).toBeLessThanOrEqual(
				perToolTokenCeilings[name],
			);
		}
	});

	it("keeps advanced scrape fields off lean tools", () => {
		for (const tool of webTools) {
			const fields = schemaProperties(tool);
			for (const field of scrapeOnlyFields) {
				if (tool.name === "web_scrape") expect(fields).toContain(field);
				else expect(fields, `${tool.name}.${field}`).not.toContain(field);
			}
		}

		for (const toolName of ["web_map", "web_vertical_scrape"] as const) {
			const fields = schemaProperties(toolByName(toolName));
			for (const field of configOnlyCacheFields) {
				expect(fields, `${toolName}.${field}`).not.toContain(field);
			}
		}
	});

	it("preserves minimal description discriminators for model selection", () => {
		for (const [toolName, checks] of Object.entries(discriminatorChecks)) {
			const description = toolByName(toolName).description;
			for (const check of checks) {
				expect(description, `${toolName} missing ${check}`).toMatch(check);
			}
		}
	});
});

function serializeContract(tool: WebTool): string {
	return JSON.stringify({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	});
}

function approximateTokens(chars: number): number {
	return Math.ceil(chars / 4);
}

function schemaProperties(tool: WebTool): string[] {
	const schema = tool.parameters as { properties?: Record<string, unknown> };
	return Object.keys(schema.properties ?? {});
}

function toolByName(name: string): WebTool {
	const tool = webTools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Missing tool ${name}`);
	return tool;
}
