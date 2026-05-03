#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import TurndownService from "turndown";
import turndownPluginGfm from "turndown-plugin-gfm";
import { buildAndImport } from "./harness/build-pipeline.mjs";
import { intFlag } from "./harness/cli-args.mjs";
import { timedRepeats } from "./harness/stats.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const args = process.argv.slice(2);
const warmup = intFlag(args, "warmup", 5);
const repeats = intFlag(args, "repeats", 50);
const minBytes = intFlag(args, "min-bytes", 50_000);
const fixtureNames = flagList(args, "fixtures");
const compiled = await buildAndImport(rootDir);
const fixtures = await loadFixtures(path.join(rootDir, "eval/fixtures"), {
	fixtureNames,
	minBytes,
});

if (fixtures.length === 0) {
	console.error("No matching HTML fixtures found.");
	process.exit(1);
}

for (const fixture of fixtures) {
	fixture.cleanedHtml = compiled.extractFastPage(
		fixture.html,
		pathToFileURL(fixture.path).toString(),
		{ removeImages: true },
	).html;
}

const variants = buildVariants(compiled);
const cases = [];
for (const fixture of fixtures) {
	const tools = [];
	for (const variant of variants) {
		const sample = variant.run(fixture);
		const perf = await timedRepeats(() => variant.run(fixture), {
			warmup,
			repeats,
		});
		tools.push({ name: variant.name, quality: markdownStats(sample), perf });
	}
	cases.push({
		fixture: path.relative(rootDir, fixture.path),
		bytes: fixture.bytes,
		cleanedHtmlChars: fixture.cleanedHtml.length,
		tools,
	});
}

const report = {
	kind: "turndown-rule-profile",
	generatedAt: new Date().toISOString(),
	nodeVersion: process.version,
	modeFlags: { warmup, repeats, minBytes },
	cases,
};
const markdown = renderMarkdown(report);
await writeReport({ rootDir, report, markdown });
console.log(markdown);

function buildVariants(compiled) {
	const base = createService({
		gfm: false,
		stableLinks: false,
		removeImages: false,
	});
	const gfm = createService({
		gfm: true,
		stableLinks: false,
		removeImages: false,
	});
	const stable = createService({
		gfm: true,
		stableLinks: true,
		removeImages: false,
	});
	const stableRemove = createService({
		gfm: true,
		stableLinks: true,
		removeImages: true,
	});
	return [
		{ name: "turndown", run: (f) => base.turndown(f.cleanedHtml) },
		{
			name: "turndown+normalizeWhitespace",
			run: (f) => normalizeWhitespace(base.turndown(f.cleanedHtml)),
		},
		{ name: "turndown+gfm", run: (f) => gfm.turndown(f.cleanedHtml) },
		{
			name: "turndown+gfm+normalizeWhitespace",
			run: (f) => normalizeWhitespace(gfm.turndown(f.cleanedHtml)),
		},
		{
			name: "turndown+gfm+stableLinks",
			run: (f) => stable.turndown(f.cleanedHtml),
		},
		{
			name: "turndown+gfm+stableLinks+normalizeWhitespace",
			run: (f) => normalizeWhitespace(stable.turndown(f.cleanedHtml)),
		},
		{
			name: "turndown+gfm+stableLinks+removeImages+normalizeWhitespace",
			run: (f) => normalizeWhitespace(stableRemove.turndown(f.cleanedHtml)),
		},
		{
			name: "pi-scraper(htmlToMarkdown)",
			run: (f) =>
				compiled.htmlToMarkdown(f.cleanedHtml, { removeImages: true }),
		},
	];
}

function createService({ gfm, stableLinks, removeImages }) {
	const service = new TurndownService({
		codeBlockStyle: "fenced",
		headingStyle: "atx",
		bulletListMarker: "-",
		emDelimiter: "_",
		strongDelimiter: "**",
	});
	if (gfm) service.use(turndownPluginGfm.gfm);
	service.remove(["script", "style", "noscript", "template"]);
	if (removeImages) {
		service.addRule("removeImages", { filter: "img", replacement: () => "" });
	}
	if (stableLinks) {
		service.addRule("stableLinks", {
			filter: "a",
			replacement: (content, node) => {
				const href = node.getAttribute("href");
				const label = normalizeWhitespace(content);
				if (!href) return label;
				return label ? `[${label}](${href})` : href;
			},
		});
	}
	return service;
}

async function loadFixtures(dir, { fixtureNames, minBytes }) {
	const entries = await readdir(dir, { withFileTypes: true });
	const names = new Set(fixtureNames);
	const out = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
		if (names.size > 0 && !names.has(entry.name.replace(/\.html$/u, ""))) {
			continue;
		}
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
	const dir = path.join(rootDir, "bench/results");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, `turndown-rules-${report.generatedAt}.json`),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	await writeFile(path.join(dir, "turndown-rules-latest.md"), markdown);
}

function renderMarkdown(report) {
	const lines = [
		"# Turndown rule profile",
		"",
		`Generated: ${report.generatedAt} · Node: ${report.nodeVersion} · warmup ${report.modeFlags.warmup} × repeats ${report.modeFlags.repeats}`,
		"",
	];
	for (const c of report.cases) {
		lines.push(
			`## ${c.fixture}`,
			"",
			`Bytes: ${c.bytes} · Cleaned HTML chars: ${c.cleanedHtmlChars}`,
			"",
			"| Variant | Samples | Median ms | Mean ms | P95 ms | Chars | Links | Tables |",
			"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		);
		for (const tool of c.tools) lines.push(toolRow(tool));
		lines.push("");
	}
	return lines.join("\n");
}

function toolRow(tool) {
	return `| ${tool.name} | ${tool.perf.samples} | ${tool.perf.median_ms} | ${tool.perf.mean_ms} | ${tool.perf.p95_ms} | ${tool.quality.chars} | ${tool.quality.link_count} | ${tool.quality.table_row_count} |`;
}

function markdownStats(markdown) {
	return {
		chars: markdown.length,
		link_count: (markdown.match(/\]\([^)]*\)/gu) ?? []).length,
		table_row_count: (markdown.match(/^\|.*\|\s*$/gmu) ?? []).length,
	};
}

function normalizeWhitespace(text) {
	return text
		.replace(/\r\n?/gu, "\n")
		.replace(/[\t ]+/gu, " ")
		.replace(/ *\n */gu, "\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
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
