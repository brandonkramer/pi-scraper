import { describe, expect, it } from "vitest";
import type { WebTool } from "../define.js";
import { webTools } from "../register.js";

const expectedNames = [
	"web_scrape",
	"web_summarize",
	"web_crawl",
	"web_map",
	"web_batch",
	"web_diff",
	"web_extract",
] as const;

const perToolTokenCeilings: Record<(typeof expectedNames)[number], number> = {
	web_scrape: 420,
	web_crawl: 290,
	web_map: 180,
	web_batch: 180,
	web_diff: 180,
	web_extract: 560,
	web_summarize: 230,
};

const scrapeOnlyFields = [
	"proxy",
	"respectRobots",
	"maxChars",
	"onlyMainContent",
	"timeoutSeconds",
	"refresh",
] as const;

const configOnlyFields = [
	"headers",
	"maxBytes",
	"browserProfile",
	"osProfile",
	"removeImages",
	"cacheTtlSeconds",
	"maxAgeSeconds",
] as const;

const discriminatorChecks: Record<string, RegExp[]> = {
	web_scrape: [/read|fetch|extract/iu, /URL|content/iu],
	web_summarize: [/summarize/iu, /URL|content/iu, /multi-source/iu],
	web_crawl: [/crawl/iu, /status|list/iu, /pages|linked-page/iu],
	web_map: [
		/robots\/sitemaps\/llms/iu,
		/no bodies|no page bodies|does not fetch page content/iu,
	],
	web_batch: [/per-URL/iu],
	web_diff: [/compare/iu, /snapshot/iu],
	web_extract: [
		/verticals?|extractors?/iu,
		/patterns|regex/iu,
		/JSON\/schema/iu,
	],
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

		expect(totalTokens).toBeLessThanOrEqual(1800);
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

		for (const tool of webTools) {
			const fields = schemaProperties(tool);
			for (const field of configOnlyFields) {
				expect(fields, `${tool.name}.${field}`).not.toContain(field);
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
