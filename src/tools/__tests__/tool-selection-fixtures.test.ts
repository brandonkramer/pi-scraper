import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WebTool } from "../define.js";
import { webTools } from "../register.js";

interface ToolSelectionFixture {
	id: string;
	prompt: string;
	expectedTool: `web_${string}` | null;
	expectedArgs?: Record<string, unknown>;
	rationale: string;
	tags: string[];
}

const fixtures = JSON.parse(
	readFileSync(
		new URL("../../../eval/tool-selection/prompts.json", import.meta.url),
		"utf8",
	),
) as ToolSelectionFixture[];

const toolsByName = new Map(webTools.map((tool) => [tool.name, tool]));

const inputCuePatterns: Record<string, RegExp> = {
	web_scrape: /https?:\/\/|\bURL\b|\bone-url\b|\bmarkdown\b/iu,
	web_summarize:
		/https?:\/\/|\bsummarize\b|\bbullets\b|\bone-page\b|\bprovided-content\b/iu,
	web_crawl:
		/https?:\/\/|\bsite\b|\bseed\b|\bdepth\b|\blinked pages\b|\bcrawlId\b|\bstatus\b|\bresume\b/iu,
	web_map: /https?:\/\/|\bsite\b|\bseed\b|\brobots\b|\bsitemaps?\b|\bllms\b/iu,
	web_batch: /\bURLs\b|\bper-URL\b|\bindependent\b/iu,
	web_diff: /https?:\/\/|\bhomepage\b|\bsnapshot\b|\bdiff\b|\bcompare\b/iu,
	web_extract:
		/https?:\/\/|\bpage\b|\bcontent\b|\bJSON\b|\bschema\b|\bextractors\b|\bnpm\b|\bgithub\b|\bdeepwiki\b|\bregex\b|\bmarkers\b/iu,
};

const scrapeIntentWithUrl =
	/(scrape|crawl|fetch|extract|summarize|compare|diff|map|list pages)[\s\S]*https?:\/\//iu;

describe("tool-selection fixtures", () => {
	it("reference only registered web tools", () => {
		for (const fixture of fixtures) {
			if (fixture.expectedTool) {
				expect(
					toolsByName.has(fixture.expectedTool),
					`${fixture.id} references ${fixture.expectedTool}`,
				).toBe(true);
			}
		}
	});

	it("keep positive fixtures aligned with tool descriptions and inputs", () => {
		for (const fixture of positiveFixtures()) {
			const tool = toolByName(fixture.expectedTool);
			expect(
				discriminatorOverlap(fixture, tool),
				`${fixture.id} has no lexical overlap with ${tool.name}`,
			).toBeGreaterThan(0);
			expect(
				fixtureText(fixture),
				`${fixture.id} lacks input/result cue for ${tool.name}`,
			).toMatch(inputCuePatterns[tool.name]);
		}
	});

	it("keeps negative fixtures from accidentally targeting pi-scraper", () => {
		for (const fixture of fixtures.filter(
			(item) => item.expectedTool === null,
		)) {
			if (scrapeIntentWithUrl.test(fixture.prompt)) {
				expect(fixture.rationale).toMatch(
					/companion|not pi-scraper|not a single|unrelated|not public|unsupported/iu,
				);
			}
			expect(fixture.tags).toContain("negative");
		}
	});

	it("covers every tool with a positive and a contrast fixture", () => {
		for (const tool of webTools) {
			const positives = fixtures.filter(
				(fixture) => fixture.expectedTool === tool.name,
			);
			const contrasts = fixtures.filter(
				(fixture) =>
					fixture.expectedTool !== tool.name &&
					fixture.tags.includes(`contrast:${tool.name}`),
			);
			expect(
				positives.length,
				`${tool.name} positive coverage`,
			).toBeGreaterThan(0);
			expect(
				contrasts.length,
				`${tool.name} contrast coverage`,
			).toBeGreaterThan(0);
		}
	});
});

function positiveFixtures(): Array<
	ToolSelectionFixture & { expectedTool: `web_${string}` }
> {
	return fixtures.filter(
		(
			fixture,
		): fixture is ToolSelectionFixture & { expectedTool: `web_${string}` } =>
			fixture.expectedTool !== null,
	);
}

function toolByName(name: `web_${string}`): WebTool {
	const tool = toolsByName.get(name);
	if (!tool) throw new Error(`Missing tool ${name}`);
	return tool;
}

function discriminatorOverlap(
	fixture: ToolSelectionFixture,
	tool: WebTool,
): number {
	const fixtureWords = new Set(
		words(`${fixture.rationale} ${fixture.tags.join(" ")}`),
	);
	const toolWords = new Set(
		words(
			`${tool.name} ${tool.description} ${schemaProperties(tool).join(" ")}`,
		),
	);
	return [...fixtureWords].filter((word) => toolWords.has(word)).length;
}

function fixtureText(fixture: ToolSelectionFixture): string {
	return `${fixture.prompt} ${fixture.rationale} ${fixture.tags.join(" ")}`;
}

function schemaProperties(tool: WebTool): string[] {
	const schema = tool.parameters as { properties?: Record<string, unknown> };
	return Object.keys(schema.properties ?? {});
}

function words(text: string): string[] {
	return text
		.replace(/([a-z])([A-Z])/gu, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/u)
		.filter((word) => word.length > 1);
}
