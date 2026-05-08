#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { intFlag, stringFlag } from "../../lib/cli-args.mjs";
import {
	clean,
	createCheerioAdapter,
	createHtmlparser2Adapter,
	flagList,
	loadHtmlFixtures,
} from "../../lib/fixtures.mjs";
import { timedRepeats } from "../../lib/stats.mjs";
import { safeSelect, writeBenchmarkReport } from "../../lib/report.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const args = process.argv.slice(2);
const warmup = intFlag(args, "warmup", 2);
const repeats = intFlag(args, "repeats", 10);
const concurrency = intFlag(args, "concurrency", 4);
const fixtureNames = flagList(args, "fixtures");
const fixtureDir = path.resolve(
	rootDir,
	stringFlag(args, "fixture-dir", "eval/fixtures"),
);
const fixtures = await loadHtmlFixtures(fixtureDir, fixtureNames);

const tools = [createCheerioAdapter(), createHtmlparser2Adapter()];
const results = [];

for (const adapter of tools) {
	const timing = await timedRepeats(() => runAdapterBatch(adapter, fixtures), {
		warmup,
		repeats,
	});
	const checksum = await runAdapterBatch(adapter, fixtures);
	results.push({ name: adapter.name, timing, checksum });
}

const report = {
	kind: "dom-adapter-in-memory-batch-timing",
	generatedAt: new Date().toISOString(),
	fixtureDir,
	fixtureCount: fixtures.length,
	concurrency,
	note: "In-memory DOM adapter batch only. Fixture HTML is preloaded; no network, SSRF guard, scrapeUrl pipeline, or markdown serialization is timed.",
	tools: results,
};
const markdown = renderMarkdown(report);
await writeBenchmarkReport({
	rootDir,
	suite: "dom-adapters",
	kind: "timing",
	report,
	markdown,
});
console.log(markdown);

async function runAdapterBatch(adapter, inputFixtures) {
	let checksum = 0;
	await mapLimit(inputFixtures, concurrency, async (fixture) => {
		checksum += runAdapterOnce(adapter, fixture.html);
	});
	return checksum;
}

function runAdapterOnce(adapter, html) {
	const doc = adapter.load(html);
	const body = safeSelect(adapter, doc, "body");
	const root = body.length
		? body
		: safeSelect(adapter, doc, "html").length
			? []
			: adapter.root(doc);
	return clean(adapter.text(doc, root)).length + adapter.html(doc, root).length;
}


async function mapLimit(items, limit, fn) {
	let next = 0;
	async function worker() {
		while (next < items.length) await fn(items[next++]);
	}
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => worker()),
	);
}


function renderMarkdown(report) {
	const lines = [
		"# DOM adapter in-memory batch timing",
		"",
		`Generated: ${report.generatedAt} · fixtures: ${report.fixtureCount} · concurrency: ${report.concurrency}`,
		"",
		report.note,
		"",
		"| Tool | Median ms | Mean ms | p95 ms | Checksum |",
		"| --- | ---: | ---: | ---: | ---: |",
	];
	for (const tool of report.tools)
		lines.push(
			`| ${tool.name} | ${tool.timing.median_ms} | ${tool.timing.mean_ms} | ${tool.timing.p95_ms} | ${tool.checksum} |`,
		);
	return lines.join("\n");
}
