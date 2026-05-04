#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { intFlag, stringFlag } from "../harness/cli-args.mjs";
import {
	clean,
	createCheerioAdapter,
	createHtmlparser2Adapter,
	flagList,
	loadHtmlFixtures,
} from "../harness/dom-adapters.mjs";
import { timedRepeats } from "../harness/stats.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
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
await writeReport(report, markdown);
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

function safeSelect(adapter, doc, selector) {
	try {
		return adapter.select(doc, selector);
	} catch {
		return [];
	}
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

async function writeReport(report, markdown) {
	const dir = path.join(rootDir, "bench/results");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, `dom-adapter-batch-timing-${report.generatedAt}.json`),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	await writeFile(
		path.join(dir, "dom-adapter-batch-timing-latest.md"),
		markdown,
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
