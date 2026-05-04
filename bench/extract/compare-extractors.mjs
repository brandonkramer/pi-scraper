#!/usr/bin/env node
import { Readability } from "@mozilla/readability";
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";
import { runCompareCli } from "../harness/compare-runner.mjs";

await runCompareCli({
	scriptUrl: import.meta.url,
	defaults: { warmup: 3, repeats: 20 },
	build: ({ compiled }) => ({
		kind: "compare-extractors",
		fileKind: "compare-extract",
		title: "pi-scraper extractor comparison",
		caseHeading: (c) => c.fixture,
		qualityHeader:
			"| Tool | Title | Text chars | Headings | Links |\n| --- | :---: | ---: | ---: | ---: |",
		qualityRow: (tool) =>
			`| ${tool.name} | ${tool.quality.titleFound ? "✅" : "❌"} | ${tool.quality.text_chars} | ${tool.quality.heading_count} | ${tool.quality.link_count} |`,
		tools: [
			{
				name: "pi-scraper(fast)",
				run: piRun(compiled),
				qualityOf: htmlQuality,
			},
			{
				name: "readability+linkedom",
				run: readabilityRun,
				qualityOf: htmlQuality,
			},
			{ name: "defuddle", run: defuddleRun, qualityOf: htmlQuality },
		],
	}),
});

function piRun(compiled) {
	return async (fixture) => {
		const result = await compiled.scrapeUrl(
			fixture.fileUrl,
			{ mode: "fast", format: "markdown", removeImages: true },
			{
				httpClient: {
					fetchUrl: async () => ({
						url: fixture.fileUrl,
						finalUrl: fixture.fileUrl,
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
						contentType: "text/html; charset=utf-8",
						text: fixture.html,
						downloadedBytes: fixture.bytes,
					}),
				},
			},
		);
		return {
			title: result.data.title,
			text: result.data.text ?? "",
			html: result.data.html ?? "",
			links: (result.data.links ?? []).length,
		};
	};
}

async function readabilityRun(fixture) {
	const { document } = parseHTML(fixture.html);
	const clone = document.cloneNode(true);
	const article = new Readability(clone).parse();
	return {
		title: article?.title,
		text: article?.textContent ?? "",
		html: article?.content ?? "",
		links: countLinks(article?.content ?? ""),
	};
}

async function defuddleRun(fixture) {
	const result = await Defuddle(fixture.html, fixture.fileUrl);
	return {
		title: result?.title,
		text: stripHtml(result?.content ?? ""),
		html: result?.content ?? "",
		links: countLinks(result?.content ?? ""),
	};
}

function htmlQuality(sample) {
	return {
		titleFound: Boolean(sample.title),
		text_chars: sample.text.length,
		heading_count: (sample.html.match(/<h[1-6][\s>]/giu) ?? []).length,
		link_count: sample.links,
	};
}

function countLinks(html) {
	return (html.match(/<a[\s>]/giu) ?? []).length;
}

function stripHtml(html) {
	return html
		.replace(/<script[\s\S]*?<\/script>/giu, "")
		.replace(/<style[\s\S]*?<\/style>/giu, "")
		.replace(/<[^>]+>/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
}
