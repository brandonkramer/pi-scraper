import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildAndImport } from "./build-pipeline.mjs";
import { intFlag, stringFlag } from "./cli-args.mjs";
import { writeSuiteReport } from "./results.mjs";
import { timedRepeats } from "./stats.mjs";

export async function runCompareCli({ scriptUrl, defaults, build }) {
	const args = process.argv.slice(2);
	const rootDir = path.resolve(
		path.dirname(fileURLToPath(scriptUrl)),
		stringFlag(args, "root", "../../.."),
	);
	const warmup = intFlag(args, "warmup", defaults.warmup);
	const repeats = intFlag(args, "repeats", defaults.repeats);
	const compiled = await buildAndImport(rootDir);
	const fixtures = await loadFixtures(path.join(rootDir, "eval/fixtures"));
	for (const fixture of fixtures) fixture.rootDir = rootDir;
	const spec = await build({ compiled, fixtures, warmup, repeats });
	const activeFixtures = spec.fixtures ?? fixtures;
	const cases = await runCompare({
		fixtures: activeFixtures,
		tools: spec.tools,
		warmup,
		repeats,
		perCase: spec.perCase,
	});
	const report = {
		kind: spec.kind,
		generatedAt: new Date().toISOString(),
		nodeVersion: process.version,
		modeFlags: { warmup, repeats },
		cases,
	};
	const markdown = renderCompareMarkdown({
		title: spec.title,
		report,
		caseHeading: spec.caseHeading,
		qualityHeader: spec.qualityHeader,
		qualityRow: spec.qualityRow,
	});
	await writeCompareReport({
		rootDir,
		kind: spec.fileKind ?? spec.kind,
		resultPath: spec.resultPath,
		report,
		markdown,
	});
	console.log(markdown);
}

async function loadFixtures(dir) {
	const out = [];
	const entries = await readdir(dir, { withFileTypes: true });
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
		const full = path.join(dir, entry.name);
		const buffer = await readFile(full);
		out.push({
			path: full,
			fileUrl: pathToFileURL(full).toString(),
			html: buffer.toString("utf8"),
			bytes: buffer.byteLength,
		});
	}
	return out;
}

async function runCompare({ fixtures, tools, warmup, repeats, perCase }) {
	const cases = [];
	for (const fixture of fixtures) {
		const toolResults = [];
		for (const tool of tools) {
			const sample = await tool.run(fixture);
			const perf = await timedRepeats(() => tool.run(fixture), {
				warmup,
				repeats,
			});
			toolResults.push({
				name: tool.name,
				quality: tool.qualityOf(sample, fixture),
				perf,
			});
		}
		cases.push({
			fixture:
				fixture.label ??
				path.relative(fixture.rootDir ?? process.cwd(), fixture.path),
			...(perCase ? perCase(fixture, toolResults) : {}),
			tools: toolResults,
		});
	}
	return cases;
}

async function writeCompareReport({
	rootDir,
	kind,
	resultPath,
	report,
	markdown,
}) {
	await writeSuiteReport({
		rootDir,
		suite: resultPath?.suite ?? kind,
		kind: resultPath?.kind,
		timestamp: report.generatedAt,
		report,
		markdown,
	});
}

function renderCompareMarkdown({
	title,
	report,
	caseHeading,
	qualityHeader,
	qualityRow,
}) {
	const lines = [
		`# ${title}`,
		"",
		`Generated: ${report.generatedAt} · Node: ${report.nodeVersion} · warmup ${report.modeFlags.warmup} × repeats ${report.modeFlags.repeats}`,
		"",
	];
	const qualityRows = aggregateQuality(report.cases);
	if (qualityRows.length > 0) {
		lines.push(
			"## Aggregate quality",
			"",
			"| Tool | Cases | Mean structure score | Perfect cases |",
			"| --- | ---: | ---: | ---: |",
			...qualityRows.map(qualityAggregateRow),
			"",
		);
	}
	const aggregateRows = aggregatePerformance(report.cases);
	if (aggregateRows.length > 0) {
		lines.push(
			"## Aggregate performance",
			"",
			"| Tool | Cases | Median of medians | Mean of means | Best median cases |",
			"| --- | ---: | ---: | ---: | ---: |",
			...aggregateRows.map(aggregateRow),
			"",
		);
	}
	for (const c of report.cases) {
		lines.push(`## ${caseHeading(c)}`, "");
		lines.push("### Quality", "", qualityHeader);
		for (const tool of c.tools) lines.push(qualityRow(tool));
		lines.push("");
		lines.push(
			"### Performance (ms)",
			"",
			"| Tool | Samples | Min | Median | Mean | P95 | Max | Stddev |",
			"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		);
		for (const tool of c.tools) lines.push(perfRow(tool));
		lines.push("");
	}
	return lines.join("\n");
}

function aggregateQuality(cases) {
	if (
		!cases.every((c) =>
			c.tools.every((tool) => Number.isFinite(tool.quality.structure_score)),
		)
	) {
		return [];
	}
	const byTool = new Map();
	for (const c of cases) {
		for (const tool of c.tools) {
			const row = byTool.get(tool.name) ?? {
				name: tool.name,
				scores: [],
				perfectCases: 0,
			};
			row.scores.push(tool.quality.structure_score);
			if (tool.quality.structure_score === 100) row.perfectCases += 1;
			byTool.set(tool.name, row);
		}
	}
	return [...byTool.values()].sort(
		(a, b) => average(b.scores) - average(a.scores),
	);
}

function qualityAggregateRow(row) {
	return `| ${row.name} | ${row.scores.length} | ${round(average(row.scores))} | ${row.perfectCases} |`;
}

function aggregatePerformance(cases) {
	const byTool = new Map();
	for (const c of cases) {
		const bestMedian = Math.min(...c.tools.map((tool) => tool.perf.median_ms));
		for (const tool of c.tools) {
			const row = byTool.get(tool.name) ?? {
				name: tool.name,
				medians: [],
				means: [],
				bestMedianCases: 0,
			};
			row.medians.push(tool.perf.median_ms);
			row.means.push(tool.perf.mean_ms);
			if (tool.perf.median_ms === bestMedian) row.bestMedianCases += 1;
			byTool.set(tool.name, row);
		}
	}
	return [...byTool.values()].sort(
		(a, b) => average(a.medians) - average(b.medians),
	);
}

function aggregateRow(row) {
	return `| ${row.name} | ${row.medians.length} | ${round(average(row.medians))} | ${round(average(row.means))} | ${row.bestMedianCases} |`;
}

function perfRow(tool) {
	const p = tool.perf;
	return `| ${tool.name} | ${p.samples} | ${p.min_ms} | ${p.median_ms} | ${p.mean_ms} | ${p.p95_ms} | ${p.max_ms} | ${p.stddev_ms} |`;
}

function average(values) {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
	return Math.round(value * 100) / 100;
}
