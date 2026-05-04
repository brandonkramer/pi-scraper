#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { parseHTML } from "linkedom";
import { intFlag } from "../../lib/cli-args.mjs";
import { timedRepeats } from "../../lib/stats.mjs";
import { writeSuiteReport } from "../../lib/results.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const args = process.argv.slice(2);
const warmup = intFlag(args, "warmup", 5);
const repeats = intFlag(args, "repeats", 50);
const minBytes = intFlag(args, "min-bytes", 50_000);
const fixtureNames = flagList(args, "fixtures");

const fixtures = await loadFixtures(path.join(rootDir, "eval/fixtures"), {
	fixtureNames,
	minBytes,
});
if (fixtures.length === 0) {
	console.error("No matching HTML fixtures found.");
	process.exit(1);
}

const cases = [];
for (const fixture of fixtures) {
	const linkedomParse = await timedRepeats(
		() => {
			parseHTML(fixture.html);
		},
		{ warmup, repeats },
	);
	const linkedomParseAndQuery = await timedRepeats(
		() => {
			const { document } = parseHTML(fixture.html);
			document.querySelectorAll("a, h1, h2, h3, p, li").length;
		},
		{ warmup, repeats },
	);
	const cheerioLoad = await timedRepeats(
		() => {
			cheerio.load(fixture.html);
		},
		{ warmup, repeats },
	);
	const cheerioLoadAndQuery = await timedRepeats(
		() => {
			const $ = cheerio.load(fixture.html);
			$("a, h1, h2, h3, p, li").length;
		},
		{ warmup, repeats },
	);
	cases.push({
		fixture: path.relative(rootDir, fixture.path),
		bytes: fixture.bytes,
		tools: [
			{ name: "linkedom.parseHTML", perf: linkedomParse },
			{ name: "linkedom.parseHTML+query", perf: linkedomParseAndQuery },
			{ name: "cheerio.load", perf: cheerioLoad },
			{ name: "cheerio.load+query", perf: cheerioLoadAndQuery },
		],
	});
}

const report = {
	kind: "linkedom-parse-profile",
	generatedAt: new Date().toISOString(),
	nodeVersion: process.version,
	modeFlags: { warmup, repeats, minBytes },
	cases,
};
const markdown = renderMarkdown(report);
await writeReport({ rootDir, report, markdown });
console.log(markdown);

async function loadFixtures(dir, { fixtureNames, minBytes }) {
	const entries = await readdir(dir, { withFileTypes: true });
	const names = new Set(fixtureNames);
	const out = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
		if (names.size > 0 && !names.has(entry.name.replace(/\.html$/u, "")))
			continue;
		const full = path.join(dir, entry.name);
		const buffer = await readFile(full);
		if (names.size === 0 && buffer.byteLength < minBytes) continue;
		out.push({
			path: full,
			html: buffer.toString("utf8"),
			bytes: buffer.byteLength,
		});
	}
	return out;
}

async function writeReport({ rootDir, report, markdown }) {
	await writeSuiteReport({
		rootDir,
		suite: "parsers",
		kind: "linkedom",
		timestamp: report.generatedAt,
		report,
		markdown,
	});
}

function renderMarkdown(report) {
	const lines = [
		"# linkedom parse profile",
		"",
		`Generated: ${report.generatedAt} · Node: ${report.nodeVersion} · warmup ${report.modeFlags.warmup} × repeats ${report.modeFlags.repeats}`,
		"",
	];
	for (const c of report.cases) {
		lines.push(
			`## ${c.fixture}`,
			"",
			`Bytes: ${c.bytes}`,
			"",
			"| Tool | Samples | Min ms | Median ms | Mean ms | P95 ms | Max ms | Stddev ms |",
			"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		);
		for (const tool of c.tools) lines.push(perfRow(tool));
		lines.push("");
	}
	return lines.join("\n");
}

function perfRow(tool) {
	const p = tool.perf;
	return `| ${tool.name} | ${p.samples} | ${p.min_ms} | ${p.median_ms} | ${p.mean_ms} | ${p.p95_ms} | ${p.max_ms} | ${p.stddev_ms} |`;
}

function flagList(argv, name) {
	const match = argv.find((arg) => arg.startsWith(`--${name}=`));
	if (!match) return [];
	return match
		.split("=")[1]
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}
