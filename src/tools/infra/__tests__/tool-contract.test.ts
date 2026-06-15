/** @file Tools **tests** tool-contract.test module. */
import { describe, expect, it } from "vitest";

import type { WebTool } from "../infra/define.ts";
import { webTools } from "../infra/register.ts";

const expectedNames = [
	"web_scrape",
	"web_crawl",
	"web_map",
	"web_batch",
	"web_extract",
	"web_get_result",
	"web_browser",
] as const;

// Ceilings ratcheted to measured actuals + ~10% headroom so contract creep trips
// CI. Re-baseline here only with a matching eval run when a contract intentionally grows.
const perToolTokenCeilings: Record<(typeof expectedNames)[number], number> = {
	web_scrape: 260,
	web_crawl: 175,
	web_map: 60,
	web_batch: 165,
	web_extract: 430,
	web_get_result: 70,
	// Measured 242 after screenshot|evaluate actions (2026-03); +~12% headroom.
	web_browser: 270,
};

const scrapeOnlyFields = [
	"maxChars",
	"onlyMainContent",
	"timeoutSeconds",
	"refresh",
	"chunks",
	"maxTokens",
	"overlapTokens",
] as const;

const configOnlyFields = [
	"browserProfile",
	"osProfile",
	"removeImages",
	"cacheTtlSeconds",
	"maxAgeSeconds",
] as const;

const discriminatorChecks: Record<string, RegExp[]> = {
	web_scrape: [/read|fetch|extract/iu, /URL|content/iu],
	web_crawl: [/crawl/iu, /status|list/iu, /pages|linked-page/iu],
	web_map: [/robots\/sitemaps\/llms/iu, /no bodies|no page bodies|does not fetch page content/iu],
	web_batch: [/per-URL/iu],
	web_extract: [/verticals?|extractors?/iu, /patterns|regex/iu, /JSON\/schema/iu],
	web_get_result: [/retrieve/iu, /stored response|job manifest/iu],
	web_browser: [
		/navigate|click|fill|select|snapshot|capture|screenshot|evaluate/iu,
		/sessionId|stateful|live page/iu,
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
		const totalTokens = contractStats.reduce((total, stat) => total + stat.tokens, 0);
		expect(totalTokens).toBeLessThanOrEqual(1250);
		for (const stat of contractStats) {
			const name = stat.name as (typeof expectedNames)[number];
			expect(stat.tokens).toBeLessThanOrEqual(perToolTokenCeilings[name]);
		}
	});

	it("keeps advanced scrape fields off lean tools", () => {
		for (const tool of webTools) {
			const fields = schemaProperties(tool);
			const isScrape = tool.name === "web_scrape";
			const missing = scrapeOnlyFields.filter((f) => {
				if (tool.name === "web_browser" && f === "timeoutSeconds") return false;
				return fields.includes(f) === !isScrape;
			});
			expect(missing).toEqual([]);
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
