#!/usr/bin/env node
import { htmlToText } from "html-to-text";
import { NodeHtmlMarkdown } from "node-html-markdown";
import TurndownService from "turndown";
import turndownPluginGfm from "turndown-plugin-gfm";
import { runCompareCli } from "../harness/compare-runner.mjs";

// Configure raw turndown to match pi-scraper's wrapper defaults (atx headings, fenced code, dash bullets)
// so the heading_count quality metric is not skewed by Turndown's setext default.
const turndownOptions = {
	codeBlockStyle: "fenced",
	headingStyle: "atx",
	bulletListMarker: "-",
	emDelimiter: "_",
	strongDelimiter: "**",
};
const turndown = new TurndownService(turndownOptions);
const turndownGfm = new TurndownService(turndownOptions);
turndownGfm.use(turndownPluginGfm.gfm);

await runCompareCli({
	scriptUrl: import.meta.url,
	defaults: { warmup: 3, repeats: 50 },
	build: ({ compiled, fixtures }) => {
		// Build cleaned HTML once per fixture so the serializer benchmark isolates the HTML→Markdown step.
		for (const fixture of fixtures) prepareFixture(compiled, fixture);
		const allFixtures = [
			...fixtures,
			syntheticFixture(fixtures[0], "synthetic/repeated-doc-10x", 10),
			syntheticFixture(fixtures[0], "synthetic/repeated-doc-50x", 50),
		];
		return {
			kind: "compare-serializers",
			fileKind: "compare-serialize",
			title: "pi-scraper serializer comparison",
			caseHeading: (c) =>
				`${c.fixture} (cleaned HTML: ${c.cleaned_html_chars} chars)`,
			qualityHeader:
				"| Tool | Score | Chars | H | Links | Lists | Code | Tables | HTML leaks |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
			qualityRow: (tool) =>
				`| ${tool.name} | ${tool.quality.structure_score} | ${tool.quality.chars} | ${tool.quality.heading_count} | ${tool.quality.link_count} | ${tool.quality.list_marker_count} | ${tool.quality.code_fence_count} | ${tool.quality.table_row_count} | ${tool.quality.html_tag_leaks} |`,
			perCase: (fixture) => ({
				cleaned_html_chars: fixture.cleanedHtml.length,
				expected_features: fixture.expectedFeatures,
			}),
			fixtures: allFixtures,
			tools: [
				{
					name: "pi-scraper(htmlToMarkdown)",
					run: (f) =>
						compiled.htmlToMarkdown(f.cleanedHtml, { removeImages: true }),
					qualityOf: markdownQuality,
				},
				{
					name: "turndown",
					run: (f) => turndown.turndown(f.cleanedHtml),
					qualityOf: markdownQuality,
				},
				{
					name: "turndown+gfm",
					run: (f) => turndownGfm.turndown(f.cleanedHtml),
					qualityOf: markdownQuality,
				},
				{
					name: "node-html-markdown",
					run: (f) => NodeHtmlMarkdown.translate(f.cleanedHtml),
					qualityOf: markdownQuality,
				},

				{
					name: "html-to-text(text baseline)",
					run: (f) => htmlToText(f.cleanedHtml, { wordwrap: false }),
					qualityOf: markdownQuality,
				},
			],
		};
	},
});

function prepareFixture(compiled, fixture) {
	fixture.cleanedHtml = compiled.extractFastPage(
		fixture.html,
		fixture.fileUrl,
		{
			removeImages: true,
		},
	).html;
	fixture.expectedFeatures = expectedFeatures(fixture.cleanedHtml);
	return fixture;
}

function syntheticFixture(seed, label, repeats) {
	const cleanedHtml = seed.cleanedHtml.repeat(repeats);
	return {
		...seed,
		label,
		cleanedHtml,
		expectedFeatures: scaleFeatures(seed.expectedFeatures, repeats),
	};
}

function markdownQuality(md, fixture) {
	const counts = {
		chars: md.length,
		heading_count: (md.match(/^#{1,6}\s/gmu) ?? []).length,
		link_count: (md.match(/\]\([^)]*\)/gu) ?? []).length,
		list_marker_count: (md.match(/^\s*(?:[-*+] |\d+\. )/gmu) ?? []).length,
		code_fence_count: (md.match(/^```/gmu) ?? []).length,
		table_row_count: (md.match(/^\|.*\|\s*$/gmu) ?? []).length,
		html_tag_leaks: (md.match(/<\/?[a-z][^>]*>/giu) ?? []).length,
	};
	return {
		...counts,
		structure_score: structureScore(counts, fixture.expectedFeatures),
	};
}

function expectedFeatures(html) {
	return {
		heading_count: (html.match(/<h[1-6][\s>]/giu) ?? []).length,
		link_count: (html.match(/<a[\s>]/giu) ?? []).length,
		list_marker_count: (html.match(/<li[\s>]/giu) ?? []).length,
		code_fence_count: (html.match(/<(?:pre|code)[\s>]/giu) ?? []).length,
		table_row_count: (html.match(/<tr[\s>]/giu) ?? []).length,
	};
}

function scaleFeatures(features, factor) {
	return Object.fromEntries(
		Object.entries(features).map(([key, value]) => [key, value * factor]),
	);
}

function structureScore(counts, expected) {
	const keys = Object.keys(expected).filter((key) => expected[key] > 0);
	if (keys.length === 0) return 100;
	const ratios = keys.map((key) => Math.min(counts[key] / expected[key], 1));
	const penalty = counts.html_tag_leaks > 0 ? 10 : 0;
	return Math.max(0, Math.round((sum(ratios) / keys.length) * 100 - penalty));
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}
