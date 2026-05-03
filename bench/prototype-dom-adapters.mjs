#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import * as cssSelect from "css-select";
import * as domutils from "domutils";
import { parseDocument } from "htmlparser2";
import { parseHTML } from "linkedom";
import { intFlag } from "./harness/cli-args.mjs";
import { timedRepeats } from "./harness/stats.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const args = process.argv.slice(2);
const warmup = intFlag(args, "warmup", 3);
const repeats = intFlag(args, "repeats", 20);
const fixtureNames = flagList(args, "fixtures");

const DEFAULT_REMOVE = "script,style,noscript,template,iframe,canvas";
const SURVEY_SELECTORS = [
	"meta",
	"a[href]",
	"h1,h2,h3,h4,h5,h6",
	"script",
	"style",
	"link[href]",
	"img[src]",
	"main,article,[role='main'],.content,.main-content,#content,#main,body",
];

const adapters = [
	createCheerioAdapter(),
	createLinkedomAdapter(),
	createHtmlparser2Adapter(),
];

const fixtures = await loadFixtures(path.join(rootDir, "eval/fixtures"));
if (fixtures.length === 0) {
	console.error("No matching HTML fixtures found.");
	process.exit(1);
}

const cases = [];
for (const fixture of fixtures) {
	const baseline = snapshotWith(adapters[0], fixture.html);
	const tools = [];
	for (const adapter of adapters) {
		const parse = await timedRepeats(
			() => {
				adapter.load(fixture.html);
			},
			{ warmup, repeats },
		);
		const parseAndSurvey = await timedRepeats(
			() => {
				snapshotWith(adapter, fixture.html);
			},
			{ warmup, repeats },
		);
		const snapshot = snapshotWith(adapter, fixture.html);
		tools.push({
			name: adapter.name,
			parse,
			parseAndSurvey,
			quality: snapshot,
			delta: qualityDelta(snapshot, baseline),
		});
	}
	cases.push({
		fixture: path.relative(rootDir, fixture.path),
		bytes: fixture.bytes,
		baseline: adapters[0].name,
		tools,
	});
}

const report = {
	kind: "cheerio-ectomy-dom-adapter-spike",
	generatedAt: new Date().toISOString(),
	nodeVersion: process.version,
	modeFlags: { warmup, repeats, fixtures: fixtureNames },
	adapterSurface: ["load", "select", "text", "attr", "html", "remove", "root"],
	packageConstraint:
		"htmlparser2/css-select/domutils are currently transitive dependencies through cheerio; a production switch must declare direct dependencies before importing them from runtime source.",
	cases,
};
const markdown = renderMarkdown(report);
await writeReport({ report, markdown });
console.log(markdown);

function createCheerioAdapter() {
	return {
		name: "cheerio",
		load: (html) => cheerio.load(html),
		select: ($, selector, root) =>
			(root ? root.find(selector) : $(selector)).toArray(),
		text: ($, nodes) => $(nodes).text(),
		attr: ($, node, name) => $(node).attr(name),
		html: ($, nodes) => nodes.map((node) => $.html(node) ?? "").join("\n"),
		remove: ($, nodes) => $(nodes).remove(),
		root: ($) => $.root().toArray(),
	};
}

function createLinkedomAdapter() {
	return {
		name: "linkedom",
		load: (html) => parseHTML(html).document,
		select: (document, selector, roots) => {
			const base = roots?.length ? roots : [document];
			return base.flatMap((node) =>
				Array.from(node.querySelectorAll?.(selector) ?? []),
			);
		},
		text: (_document, nodes) =>
			nodes.map((node) => node.textContent ?? "").join(""),
		attr: (_document, node, name) => node.getAttribute?.(name) ?? undefined,
		html: (_document, nodes) =>
			nodes.map((node) => node.outerHTML ?? "").join("\n"),
		remove: (_document, nodes) => nodes.forEach((node) => node.remove?.()),
		root: (document) => [document],
	};
}

function createHtmlparser2Adapter() {
	return {
		name: "htmlparser2+css-select",
		load: (html) =>
			parseDocument(html, {
				lowerCaseTags: true,
				lowerCaseAttributeNames: true,
			}),
		select: (document, selector, roots) =>
			cssSelect.selectAll(selector, roots?.length ? roots : document.children),
		text: (_document, nodes) => domutils.textContent(nodes),
		attr: (_document, node, name) => domutils.getAttributeValue(node, name),
		html: (_document, nodes) =>
			nodes.map((node) => domutils.getOuterHTML(node)).join("\n"),
		remove: (_document, nodes) =>
			nodes.forEach((node) => domutils.removeElement(node)),
		root: (document) => document.children,
	};
}

function snapshotWith(adapter, html) {
	const doc = adapter.load(html);
	const countsBeforeRemove = Object.fromEntries(
		SURVEY_SELECTORS.map((selector) => [
			selector,
			safeSelect(adapter, doc, selector).length,
		]),
	);
	const jsonLdCount = safeSelect(
		adapter,
		doc,
		'script[type="application/ld+json"]',
	).length;
	adapter.remove(doc, safeSelect(adapter, doc, DEFAULT_REMOVE));
	const body = safeSelect(adapter, doc, "body");
	const root = body.length ? body : adapter.root(doc);
	const title = clean(
		adapter.text(doc, safeSelect(adapter, doc, "head > title").slice(0, 1)),
	);
	const description = firstAttr(
		adapter,
		doc,
		'meta[name="description"][content]',
		"content",
	);
	const canonical = firstAttr(adapter, doc, 'link[rel~="canonical"]', "href");
	const headings = safeSelect(adapter, doc, "h1,h2,h3,h4,h5,h6");
	const links = safeSelect(adapter, doc, "a[href]");
	const themeColors = safeSelect(
		adapter,
		doc,
		'meta[name="theme-color"][content]',
	);
	const logoCandidates = safeSelect(adapter, doc, "img[src]").filter((node) => {
		const sample = ["src", "alt", "class", "id"]
			.map((name) => adapter.attr(doc, node, name) ?? "")
			.join(" ");
		return /logo|brand|mark/iu.test(sample);
	});
	return {
		titleFound: Boolean(title),
		descriptionFound: Boolean(description),
		canonicalFound: Boolean(canonical),
		headingCount: headings.length,
		linkCount: links.length,
		themeColorCount: themeColors.length,
		jsonLdCount,
		logoCandidateCount: logoCandidates.length,
		bodyTextChars: clean(adapter.text(doc, root)).length,
		bodyHtmlChars: adapter.html(doc, root).length,
		countsBeforeRemove,
	};
}

function safeSelect(adapter, doc, selector) {
	try {
		return adapter.select(doc, selector);
	} catch {
		return [];
	}
}

function firstAttr(adapter, doc, selector, name) {
	const [node] = safeSelect(adapter, doc, selector);
	return node ? adapter.attr(doc, node, name) : undefined;
}

function qualityDelta(sample, baseline) {
	return {
		titleFound: boolDelta(sample.titleFound, baseline.titleFound),
		descriptionFound: boolDelta(
			sample.descriptionFound,
			baseline.descriptionFound,
		),
		canonicalFound: boolDelta(sample.canonicalFound, baseline.canonicalFound),
		headingCount: sample.headingCount - baseline.headingCount,
		linkCount: sample.linkCount - baseline.linkCount,
		themeColorCount: sample.themeColorCount - baseline.themeColorCount,
		jsonLdCount: sample.jsonLdCount - baseline.jsonLdCount,
		logoCandidateCount: sample.logoCandidateCount - baseline.logoCandidateCount,
		bodyTextChars: sample.bodyTextChars - baseline.bodyTextChars,
		bodyHtmlChars: sample.bodyHtmlChars - baseline.bodyHtmlChars,
	};
}

function boolDelta(left, right) {
	return Number(left) - Number(right);
}

async function loadFixtures(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const names = new Set(fixtureNames);
	const out = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
		const id = entry.name.replace(/\.html$/u, "");
		if (names.size > 0 && !names.has(id)) continue;
		const full = path.join(dir, entry.name);
		const buffer = await readFile(full);
		out.push({
			path: full,
			html: buffer.toString("utf8"),
			bytes: buffer.byteLength,
		});
	}
	return out;
}

async function writeReport({ report, markdown }) {
	const dir = path.join(rootDir, "bench/results");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, `cheerio-ectomy-${report.generatedAt}.json`),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	await writeFile(path.join(dir, "cheerio-ectomy-latest.md"), markdown);
}

function renderMarkdown(report) {
	const lines = [
		"# Cheerio-ectomy DOM adapter spike",
		"",
		`Generated: ${report.generatedAt} · Node: ${report.nodeVersion} · warmup ${report.modeFlags.warmup} × repeats ${report.modeFlags.repeats}`,
		"",
		`Adapter surface tested: ${report.adapterSurface.map((item) => `\`${item}\``).join(", ")}`,
		"",
		`Package constraint: ${report.packageConstraint}`,
		"",
	];
	for (const c of report.cases) {
		lines.push(
			`## ${c.fixture}`,
			"",
			`Bytes: ${c.bytes}`,
			"",
			"| Adapter | Parse median ms | Survey median ms | Δ text chars | Δ html chars | Δ headings | Δ links | Δ JSON-LD | Δ logos |",
			"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		);
		for (const tool of c.tools) lines.push(toolRow(tool));
		lines.push("");
	}
	return lines.join("\n");
}

function toolRow(tool) {
	const d = tool.delta;
	return `| ${tool.name} | ${tool.parse.median_ms} | ${tool.parseAndSurvey.median_ms} | ${d.bodyTextChars} | ${d.bodyHtmlChars} | ${d.headingCount} | ${d.linkCount} | ${d.jsonLdCount} | ${d.logoCandidateCount} |`;
}

function clean(value) {
	return value.replace(/\s+/gu, " ").trim();
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
