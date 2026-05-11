#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import TurndownService from "turndown";
import turndownPluginGfm from "turndown-plugin-gfm";

import { intFlag, stringFlag } from "../../lib/cli-args.mjs";
import {
	clean,
	createCheerioAdapter,
	createHtmlparser2Adapter,
	flagList,
	loadHtmlFixtures,
} from "../../lib/fixtures.mjs";
import { markdownRow, safeSelect, writeBenchmarkReport } from "../../lib/report.mjs";
import { timedRepeats } from "../../lib/stats.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const warmup = intFlag(args, "warmup", 5);
const repeats = intFlag(args, "repeats", 30);
const fixtureNames = flagList(args, "fixtures");
const fixtureDir = path.resolve(rootDir, stringFlag(args, "fixture-dir", "eval/fixtures"));
const adapters = [createCheerioAdapter(), createHtmlparser2Adapter()];
const scenarios = [
	{ name: "default" },
	{ name: "include-main", rootSelector: "main" },
	{ name: "exclude-noise", removeSelector: ".ads,.ad,nav,footer" },
	{
		name: "only-main-proxy",
		rootSelector: "main,article,[role='main'],.content,.main-content,#content,#main,body",
		firstRootOnly: true,
	},
];
const DATA_ISLAND_SELECTOR = [
	'script[type="application/json"]',
	'script[type="application/ld+json"]',
	'script[id="__NEXT_DATA__"]',
	'script[id="__NUXT_DATA__"]',
	"script[data-sveltekit-fetched]",
].join(",");
const markdownService = new TurndownService({
	codeBlockStyle: "fenced",
	headingStyle: "atx",
	bulletListMarker: "-",
});
markdownService.use(turndownPluginGfm.gfm);
markdownService.remove(["script", "style", "noscript", "template"]);
const fixtures = await loadHtmlFixtures(fixtureDir, fixtureNames);

if (fixtures.length === 0) {
	console.error("No matching HTML fixtures found.");
	process.exit(1);
}

const report = {
	kind: "dom-adapter-quality",
	generatedAt: new Date().toISOString(),
	nodeVersion: process.version,
	modeFlags: { warmup, repeats, fixtures: fixtureNames, fixtureDir },
	thresholds: {
		textSimilarity: 0.98,
		markdownSimilarity: 0.97,
		htmlSerialization: "informational",
	},
	scenarios,
	cases: [],
};

for (const fixture of fixtures) {
	for (const scenario of scenarios) {
		const baseline = extractWith(adapters[0], fixture.html, scenario);
		const tools = [];
		for (const adapter of adapters) {
			const timing = await timedRepeats(() => extractWith(adapter, fixture.html, scenario), {
				warmup,
				repeats,
			});
			const sample = extractWith(adapter, fixture.html, scenario);
			tools.push({
				name: adapter.name,
				timing,
				metrics: summarizeExtraction(sample),
				delta: compareExtraction(sample, baseline, report.thresholds),
			});
		}
		report.cases.push({
			fixture: path.relative(rootDir, fixture.path),
			scenario: scenario.name,
			bytes: fixture.bytes,
			baseline: adapters[0].name,
			tools,
		});
	}
}

const markdown = renderMarkdown(report);
await writeBenchmarkReport({
	rootDir,
	suite: "dom-adapters",
	kind: "quality",
	report,
	markdown,
});
console.log(markdown);

function extractWith(adapter, html, scenario) {
	const doc = adapter.load(html);
	const select = (selector, root) => safeSelect(adapter, doc, selector, root);
	const metadata = extractMetadata(adapter, doc, select);
	const headings = select("h1,h2,h3,h4,h5,h6").map((node) => ({
		tag: tagName(node),
		text: clean(adapter.text(doc, [node])),
	}));
	const links = select("a[href]").map((node) => ({
		href: adapter.attr(doc, node, "href") ?? "",
		text: clean(adapter.text(doc, [node])),
	}));
	const dataIslands = select(DATA_ISLAND_SELECTOR)
		.map((node) => scriptText(adapter, doc, node))
		.filter(isMeaningfulDataIsland);
	const dataIslandPayload = summarizeDataIslands(dataIslands);
	const removeSelector = ["script,style,noscript,template,iframe,canvas", scenario.removeSelector]
		.filter(Boolean)
		.join(",");
	adapter.remove(doc, select(removeSelector));
	const root = contentRoots(adapter, doc, select, scenario);
	const text = clean(adapter.text(doc, root));
	const htmlOut = adapter.html(doc, root);
	const markdown = clean(markdownFromHtml(htmlOut));
	return {
		metadata,
		headings,
		links,
		dataIslands,
		dataIslandPayload,
		text,
		html: htmlOut,
		markdown,
	};
}

function scriptText(adapter, doc, node) {
	const text = clean(adapter.text(doc, [node]));
	if (text) return text;
	return clean(
		adapter
			.html(doc, [node])
			.replace(/^<script\b[^>]*>/iu, "")
			.replace(/<\/script>$/iu, ""),
	);
}

function isMeaningfulDataIsland(raw) {
	const parsed = parseJsonLike(raw);
	if (parsed === undefined) return raw.length > 0;
	return hasNonEmptyLeaf(parsed);
}

function hasNonEmptyLeaf(value) {
	if (typeof value === "string") return value.trim().length > 0;
	if (typeof value === "number" || typeof value === "boolean") return true;
	if (Array.isArray(value)) return value.some(hasNonEmptyLeaf);
	if (value && typeof value === "object") return Object.values(value).some(hasNonEmptyLeaf);
	return false;
}

function contentRoots(adapter, doc, select, scenario) {
	const roots = scenario.rootSelector ? select(scenario.rootSelector) : select("body");
	const selected = scenario.firstRootOnly ? roots.slice(0, 1) : roots;
	if (selected.length) return selected;
	return select("html").length ? [] : adapter.root(doc);
}

function summarizeDataIslands(dataIslands) {
	const parsed = dataIslands.map((value) => parseJsonLike(value));
	return {
		count: dataIslands.length,
		jsonCount: parsed.filter((value) => value !== undefined).length,
		hash: hash(dataIslands.join("\n---\n")),
		keys: [...new Set(parsed.flatMap((value) => topLevelKeys(value)))].sort(),
	};
}

function parseJsonLike(value) {
	try {
		return JSON.parse(value);
	} catch {
		return;
	}
}

function topLevelKeys(value) {
	if (Array.isArray(value)) return value.flatMap((item) => topLevelKeys(item));
	if (value && typeof value === "object") return Object.keys(value).sort();
	return [];
}

function extractMetadata(adapter, doc, select) {
	const meta = {};
	meta.title = firstText(adapter, doc, select("head > title"));
	for (const node of select("meta")) {
		const key =
			adapter.attr(doc, node, "name") ??
			adapter.attr(doc, node, "property") ??
			adapter.attr(doc, node, "http-equiv");
		const value = adapter.attr(doc, node, "content");
		if (key && value) meta[key.toLowerCase()] = value;
	}
	const canonical = select('link[rel~="canonical"][href]')[0];
	if (canonical) meta.canonical = adapter.attr(doc, canonical, "href");
	return meta;
}

function firstText(adapter, doc, nodes) {
	return nodes[0] ? clean(adapter.text(doc, [nodes[0]])) : "";
}

function summarizeExtraction(sample) {
	return {
		title: sample.metadata.title,
		description: sample.metadata.description ?? sample.metadata["og:description"],
		metadataKeys: Object.keys(sample.metadata).sort(),
		headingCount: sample.headings.length,
		linkCount: sample.links.length,
		dataIslandCount: sample.dataIslandPayload.count,
		dataIslandJsonCount: sample.dataIslandPayload.jsonCount,
		dataIslandKeys: sample.dataIslandPayload.keys,
		dataIslandHash: sample.dataIslandPayload.hash,
		textChars: sample.text.length,
		markdownChars: sample.markdown.length,
		htmlChars: sample.html.length,
		textHash: hash(sample.text),
		markdownHash: hash(sample.markdown),
	};
}

function compareExtraction(sample, baseline, thresholds) {
	const textSimilarity = similarity(sample.text, baseline.text);
	const markdownSimilarity = similarity(sample.markdown, baseline.markdown);
	const metadataDelta = compareObject(sample.metadata, baseline.metadata);
	const dataIslandKeysDelta = compareArrays(
		sample.dataIslandPayload.keys,
		baseline.dataIslandPayload.keys,
	);
	return {
		status:
			textSimilarity >= thresholds.textSimilarity &&
			markdownSimilarity >= thresholds.markdownSimilarity &&
			metadataDelta.changed.length === 0 &&
			metadataDelta.missing.length === 0 &&
			sample.dataIslandPayload.count === baseline.dataIslandPayload.count &&
			sample.dataIslandPayload.jsonCount === baseline.dataIslandPayload.jsonCount &&
			sample.dataIslandPayload.hash === baseline.dataIslandPayload.hash &&
			dataIslandKeysDelta.changed.length === 0
				? "pass"
				: "review",
		titleMatch: sample.metadata.title === baseline.metadata.title,
		descriptionMatch: (sample.metadata.description ?? "") === (baseline.metadata.description ?? ""),
		metadataDelta,
		headingCountDelta: sample.headings.length - baseline.headings.length,
		linkCountDelta: sample.links.length - baseline.links.length,
		dataIslandCountDelta: sample.dataIslandPayload.count - baseline.dataIslandPayload.count,
		dataIslandJsonCountDelta:
			sample.dataIslandPayload.jsonCount - baseline.dataIslandPayload.jsonCount,
		dataIslandHashMatch: sample.dataIslandPayload.hash === baseline.dataIslandPayload.hash,
		dataIslandKeysDelta,
		textCharsDelta: sample.text.length - baseline.text.length,
		markdownCharsDelta: sample.markdown.length - baseline.markdown.length,
		htmlCharsDelta: sample.html.length - baseline.html.length,
		textSimilarity,
		markdownSimilarity,
	};
}

function compareObject(sample, baseline) {
	const sampleKeys = new Set(Object.keys(sample));
	const baselineKeys = new Set(Object.keys(baseline));
	const missing = [...baselineKeys].filter((key) => !sampleKeys.has(key)).sort();
	const added = [...sampleKeys].filter((key) => !baselineKeys.has(key)).sort();
	const changed = [...baselineKeys]
		.filter((key) => sampleKeys.has(key) && sample[key] !== baseline[key])
		.sort();
	return { missing, added, changed };
}

function compareArrays(sample, baseline) {
	return compareObject(
		Object.fromEntries(sample.map((key) => [key, true])),
		Object.fromEntries(baseline.map((key) => [key, true])),
	);
}

function similarity(left, right) {
	if (left === right) return 1;
	if (!left || !right) return 0;
	const leftSet = shingles(left);
	const rightSet = shingles(right);
	let overlap = 0;
	for (const value of leftSet) if (rightSet.has(value)) overlap++;
	return round((2 * overlap) / (leftSet.size + rightSet.size));
}

function shingles(value) {
	const normalized = clean(value).toLowerCase();
	if (normalized.length < 5) return new Set([normalized]);
	const set = new Set();
	for (let i = 0; i <= normalized.length - 5; i++) set.add(normalized.slice(i, i + 5));
	return set;
}

function markdownFromHtml(html) {
	return markdownService.turndown(html);
}

function tagName(node) {
	return (node.name ?? node.tagName ?? "").toLowerCase();
}

function renderMarkdown(report) {
	const lines = [
		"# DOM adapter quality comparison",
		"",
		`Generated: ${report.generatedAt} · Node: ${report.nodeVersion} · warmup ${report.modeFlags.warmup} × repeats ${report.modeFlags.repeats}`,
		"",
		`Fixture dir: ${report.modeFlags.fixtureDir}`,
		`Thresholds: text ≥ ${report.thresholds.textSimilarity}, markdown ≥ ${report.thresholds.markdownSimilarity}; HTML serialization deltas are informational only`,
		"",
	];
	for (const c of report.cases) {
		lines.push(
			`## ${c.fixture} · ${c.scenario}`,
			"",
			`Bytes: ${c.bytes} · baseline: ${c.baseline}`,
			"",
			"| Adapter | Status | Median ms | Text sim | Markdown sim | Δ text | Δ md | Δ html* | Δ headings | Δ links | Δ islands/json | Island hash | Island keys Δ | Meta -/~ /+ |",
			"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
		);
		for (const tool of c.tools) lines.push(toolRow(tool));
		lines.push("");
	}
	return lines.join("\n");
}

function toolRow(tool) {
	const d = tool.delta;
	const meta = [
		`-${d.metadataDelta.missing.length}`,
		`~${d.metadataDelta.changed.length}`,
		`+${d.metadataDelta.added.length}`,
	].join("/");
	const islandDelta = `${d.dataIslandCountDelta}/${d.dataIslandJsonCountDelta}`;
	const islandKeys = [
		`-${d.dataIslandKeysDelta.missing.length}`,
		`~${d.dataIslandKeysDelta.changed.length}`,
		`+${d.dataIslandKeysDelta.added.length}`,
	].join("/");
	return markdownRow([
		tool.name,
		d.status,
		tool.timing.median_ms,
		d.textSimilarity,
		d.markdownSimilarity,
		d.textCharsDelta,
		d.markdownCharsDelta,
		d.htmlCharsDelta,
		d.headingCountDelta,
		d.linkCountDelta,
		islandDelta,
		d.dataIslandHashMatch ? "same" : "diff",
		islandKeys,
		meta,
	]);
}

function hash(value) {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function round(value) {
	return Math.round(value * 1_000) / 1_000;
}
