#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { intFlag } from "../../lib/cli-args.mjs";
import {
	clean,
	createCheerioAdapter,
	createHtmlparser2Adapter,
	flagList,
	loadHtmlFixtures,
} from "../../lib/fixtures.mjs";
import { summarize } from "../../lib/stats.mjs";
import {
	markdownRow,
	safeSelect,
	writeBenchmarkReport,
} from "../../lib/report.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const args = process.argv.slice(2);
const repeats = intFlag(args, "repeats", 20);
const fixtureNames = flagList(args, "fixtures");
const fixtures = await loadHtmlFixtures(
	path.join(rootDir, "eval/fixtures"),
	fixtureNames,
);
const adapters = [createCheerioAdapter(), createHtmlparser2Adapter()];

if (!globalThis.gc) {
	console.error(
		"Run with `node --expose-gc bench/suites/dom-adapters/memory.mjs`.",
	);
	process.exit(2);
}

const report = {
	kind: "dom-adapter-memory",
	generatedAt: new Date().toISOString(),
	nodeVersion: process.version,
	modeFlags: { repeats, fixtures: fixtureNames },
	cases: [],
};

for (const fixture of fixtures) {
	const tools = [];
	for (const adapter of adapters) {
		const samples = [];
		for (let i = 0; i < repeats; i++) {
			globalThis.gc();
			const before = process.memoryUsage();
			const checksum = extractChecksum(adapter, fixture.html);
			globalThis.gc();
			const after = process.memoryUsage();
			samples.push({
				heapUsedDelta: after.heapUsed - before.heapUsed,
				rssDelta: after.rss - before.rss,
				checksum,
			});
		}
		tools.push({
			name: adapter.name,
			heapUsedKb: summarizeKb(
				samples.map((sample) => sample.heapUsedDelta / 1024),
			),
			rssKb: summarizeKb(samples.map((sample) => sample.rssDelta / 1024)),
			checksumStable:
				new Set(samples.map((sample) => sample.checksum)).size === 1,
		});
	}
	report.cases.push({
		fixture: path.relative(rootDir, fixture.path),
		bytes: fixture.bytes,
		tools,
	});
}

const markdown = renderMarkdown(report);
await writeBenchmarkReport({
	rootDir,
	suite: "dom-adapters",
	kind: "memory",
	report,
	markdown,
});
console.log(markdown);

function summarizeKb(samples) {
	const stats = summarize(samples);
	return {
		samples: stats.samples,
		minKb: stats.min_ms,
		medianKb: stats.median_ms,
		meanKb: stats.mean_ms,
		p95Kb: stats.p95_ms,
		maxKb: stats.max_ms,
		stddevKb: stats.stddev_ms,
	};
}

function extractChecksum(adapter, html) {
	const doc = adapter.load(html);
	const select = (selector) => safeSelect(adapter, doc, selector);
	const title = clean(adapter.text(doc, select("head > title").slice(0, 1)));
	const links = select("a[href]").length;
	const headings = select("h1,h2,h3,h4,h5,h6").length;
	adapter.remove(doc, select("script,style,noscript,template,iframe,canvas"));
	const body = select("body");
	const root = body.length ? body : adapter.root(doc);
	const text = clean(adapter.text(doc, root));
	const htmlOut = adapter.html(doc, root);
	return title.length + links + headings + text.length + htmlOut.length;
}

function renderMarkdown(report) {
	const lines = [
		"# DOM adapter memory comparison",
		"",
		`Generated: ${report.generatedAt} · Node: ${report.nodeVersion} · repeats ${report.modeFlags.repeats}`,
		"",
		"Values are post-GC deltas after parse/select/text/html extraction. Negative RSS deltas can occur from allocator/page reuse noise; compare medians and rerun on quiet systems.",
		"",
	];
	for (const c of report.cases) {
		lines.push(
			`## ${c.fixture}`,
			"",
			`Bytes: ${c.bytes}`,
			"",
			"| Adapter | Heap median KB | Heap p95 KB | RSS median KB | RSS p95 KB | Checksum stable |",
			"| --- | ---: | ---: | ---: | ---: | --- |",
		);
		for (const tool of c.tools) lines.push(toolRow(tool));
		lines.push("");
	}
	return lines.join("\n");
}

function toolRow(tool) {
	return markdownRow([
		tool.name,
		tool.heapUsedKb.medianKb,
		tool.heapUsedKb.p95Kb,
		tool.rssKb.medianKb,
		tool.rssKb.p95Kb,
		tool.checksumStable ? "yes" : "no",
	]);
}
