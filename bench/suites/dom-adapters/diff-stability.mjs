#!/usr/bin/env node
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import TurndownService from "turndown";
import turndownPluginGfm from "turndown-plugin-gfm";
import { stringFlag } from "../../lib/cli-args.mjs";
import {
	clean,
	createCheerioAdapter,
	createHtmlparser2Adapter,
	flagList,
	loadHtmlFixtures,
} from "../../lib/fixtures.mjs";
import { safeSelect, writeBenchmarkReport } from "../../lib/report.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const args = process.argv.slice(2);
const fixtureNames = flagList(args, "fixtures");
const fixtureDir = path.resolve(
	rootDir,
	stringFlag(args, "fixture-dir", "eval/fixtures"),
);
const fixtures = await loadHtmlFixtures(fixtureDir, fixtureNames);
const adapters = [createCheerioAdapter(), createHtmlparser2Adapter()];
const markdownService = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
});
markdownService.use(turndownPluginGfm.gfm);
markdownService.remove(["script", "style", "noscript", "template"]);

const report = {
	kind: "dom-adapter-diff-stability",
	generatedAt: new Date().toISOString(),
	fixtureDir,
	cases: [],
};
for (const fixture of fixtures) {
	const [base, candidate] = adapters.map((adapter) =>
		snapshot(adapter, fixture.html),
	);
	report.cases.push({
		fixture: path.relative(rootDir, fixture.path),
		bytes: fixture.bytes,
		textHashMatch: base.textHash === candidate.textHash,
		markdownHashMatch: base.markdownHash === candidate.markdownHash,
		textSimilarity: similarity(base.text, candidate.text),
		markdownSimilarity: similarity(base.markdown, candidate.markdown),
		potentialDiffNoise:
			base.textHash !== candidate.textHash ||
			base.markdownHash !== candidate.markdownHash,
	});
}
const markdown = renderMarkdown(report);
await writeBenchmarkReport({
	rootDir,
	suite: "dom-adapters",
	kind: "diff-stability",
	report,
	markdown,
});
console.log(markdown);

function snapshot(adapter, html) {
	const doc = adapter.load(html);
	const select = (selector) => safeSelect(adapter, doc, selector);
	adapter.remove(doc, select("script,style,noscript,template,iframe,canvas"));
	const body = select("body");
	const root = body.length
		? body
		: select("html").length
			? []
			: adapter.root(doc);
	const text = clean(adapter.text(doc, root));
	const htmlOut = adapter.html(doc, root);
	const markdown = clean(markdownService.turndown(htmlOut));
	return { text, markdown, textHash: hash(text), markdownHash: hash(markdown) };
}



function renderMarkdown(report) {
	const lines = [
		"# DOM adapter diff stability",
		"",
		`Generated: ${report.generatedAt}`,
		"",
		"| Fixture | Text hash | Markdown hash | Text sim | Markdown sim | Potential noise |",
		"| --- | --- | --- | ---: | ---: | --- |",
	];
	for (const c of report.cases)
		lines.push(
			`| ${c.fixture} | ${c.textHashMatch ? "same" : "diff"} | ${c.markdownHashMatch ? "same" : "diff"} | ${c.textSimilarity} | ${c.markdownSimilarity} | ${c.potentialDiffNoise ? "yes" : "no"} |`,
		);
	return lines.join("\n");
}

function similarity(left, right) {
	if (left === right) return 1;
	const a = shingles(left);
	const b = shingles(right);
	let overlap = 0;
	for (const value of a) if (b.has(value)) overlap++;
	return Math.round(((2 * overlap) / (a.size + b.size || 1)) * 1_000) / 1_000;
}

function shingles(value) {
	const normalized = clean(value).toLowerCase();
	if (normalized.length < 5) return new Set([normalized]);
	const out = new Set();
	for (let i = 0; i <= normalized.length - 5; i++)
		out.add(normalized.slice(i, i + 5));
	return out;
}

function hash(value) {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
