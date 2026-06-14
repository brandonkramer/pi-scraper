#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "../..");
const DISCRIMINATOR_ARG_KEYS = ["action", "task", "extractor", "format", "jsonPaths"];
// Free-form payload args have many valid forms; score presence, not exact value.
const FREE_FORM_ARG_KEYS = new Set(["jsonPaths"]);
await main();

async function main() {
	const args = process.argv.slice(2);
	const predictionsPath = valueFlag(args, "--predictions");
	const outDir = String(
		valueFlag(args, "--out-dir") ??
			path.join(rootDir, "bench/results/tool-selection"),
	);
	const fixtures = JSON.parse(
		await readFile(
			path.join(rootDir, "eval/tool-selection/prompts.json"),
			"utf8",
		),
	);
	const tools = await loadWebTools();
	const contracts = tools.map((tool) => ({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	}));
	// Only the model command produces independent samples; static/predictions
	// modes are deterministic, so repeating them adds nothing. Average N model
	// runs to keep the gate verdict above per-run noise.
	const modelMode = Boolean(process.env.PI_TOOL_SELECTION_EVAL_COMMAND) && !predictionsPath;
	const runs = modelMode ? resolveRuns(args) : 1;
	const reports = [];
	for (let i = 0; i < runs; i++) {
		const predictions = await loadPredictions({ predictionsPath, contracts, fixtures });
		reports.push(buildReport({ contracts, fixtures, predictions, predictionsPath }));
	}
	const report = runs > 1 ? aggregateReports(reports) : reports[0];
	const markdown = renderMarkdown(report);
	await mkdir(outDir, { recursive: true });
	await writeFile(
		path.join(outDir, "latest.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	await writeFile(path.join(outDir, "latest.md"), `${markdown}\n`);
	console.log(markdown);
	console.log("\nJSON:", path.join(outDir, "latest.json"));
	enforceThresholds(report);
}

async function loadWebTools() {
	const outDir = path.join(rootDir, "bench/.build/tool-selection-eval");
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	execFileSync(
		process.execPath,
		[
			path.join(rootDir, "node_modules/typescript/bin/tsc"),
			"--ignoreConfig",
			"--outDir",
			outDir,
			"--rootDir",
			path.join(rootDir, "src"),
			"--declaration",
			"false",
			"--sourceMap",
			"false",
			"--pretty",
			"false",
			"--target",
			"ES2022",
			"--lib",
			"ES2023,DOM",
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
			"--skipLibCheck",
			"--allowImportingTsExtensions",
			"--rewriteRelativeImportExtensions",
			"--types",
			"node",
			"src/env.d.ts",
			"src/tools/infra/register.ts",
		],
		{ cwd: rootDir, stdio: "pipe" },
	);
	const mod = await import(
		pathToFileURL(path.join(outDir, "tools/infra/register.js"))
	);
	return mod.webTools;
}

async function loadPredictions({ predictionsPath, contracts, fixtures }) {
	if (predictionsPath) {
		const parsed = JSON.parse(
			await readFile(path.resolve(predictionsPath), "utf8"),
		);
		return Array.isArray(parsed) ? parsed : parsed.predictions;
	}
	const command = process.env.PI_TOOL_SELECTION_EVAL_COMMAND;
	if (command) {
		const input = JSON.stringify({
			instructions:
				"Choose at most one pi-scraper web tool. Return no tool for multi-source search/research or unrelated prompts. Do not execute tools.",
			tools: contracts,
			fixtures: fixtures.map(({ id, prompt }) => ({ id, prompt })),
		});
		const result = spawnSync(command, { shell: true, input, encoding: "utf8" });
		if (result.status !== 0)
			throw new Error(result.stderr.length > 0 ? result.stderr : "model command failed");
		const parsed = JSON.parse(result.stdout);
		return Array.isArray(parsed) ? parsed : parsed.predictions;
	}
	return fixtures.map((fixture) => ({
		id: fixture.id,
		actualTool: fixture.expectedTool,
		actualArgs: fixture.expectedArgs ?? {},
		mode: "static-fixture-baseline",
	}));
}

function buildReport({ contracts, fixtures, predictions, predictionsPath }) {
	const byId = new Map(
		predictions.map((prediction) => [prediction.id, prediction]),
	);
	const rows = fixtures.map((fixture) => {
		const prediction = byId.get(fixture.id) ?? {
			id: fixture.id,
			actualTool: null,
		};
		const actualTool = prediction.actualTool ?? null;
		const actualArgs = prediction.actualArgs ?? {};
		const passed = actualTool === fixture.expectedTool;
		const expectedDiscriminators = discriminatorArgs(fixture.expectedArgs ?? {});
		// Only score discriminator keys the model actually provided. An omitted key
		// is assumed correctly inferred by the tool (crawl->run, extract->adhoc), so
		// it neither passes nor fails. A row is scorable once the tool is right and
		// >=1 expected discriminator was actually set, so there is a choice to judge.
		// ponytail: lenient on omission; a model could pass by setting only the easy
		// key. Tighten with a per-tool required-arg registry if that ever masks a real
		// regression.
		const checkedKeys = Object.keys(expectedDiscriminators).filter(
			(key) => actualArgs[key] !== undefined,
		);
		const scorableArgs = passed && checkedKeys.length > 0;
		const argsPassed = scorableArgs && argsMatch(expectedDiscriminators, actualArgs, checkedKeys);
		return {
			id: fixture.id,
			prompt: fixture.prompt,
			expectedTool: fixture.expectedTool,
			actualTool,
			actualArgs,
			passed,
			expectedDiscriminators,
			scorableArgs,
			argsPassed,
			tags: fixture.tags,
		};
	});
	const positives = rows.filter((row) => row.expectedTool !== null);
	const negatives = rows.filter((row) => row.expectedTool === null);
	const positiveAccuracy = ratio(
		positives.filter((row) => row.passed).length,
		positives.length,
	);
	const negativePrecision = ratio(
		negatives.filter((row) => row.passed).length,
		negatives.length,
	);
	const criticalConfusions = rows.filter((row) => isCriticalConfusion(row));
	const invocationScorable = rows.filter((row) => row.scorableArgs);
	const invocationAccuracy = ratio(
		invocationScorable.filter((row) => row.argsPassed).length,
		invocationScorable.length,
	);
	const contractTokenByTool = contracts.map((contract) => ({
		name: contract.name,
		tokens: Math.ceil(JSON.stringify(contract).length / 4),
	}));
	const contractTokenEstimate = contractTokenByTool.reduce(
		(sum, entry) => sum + entry.tokens,
		0,
	);
	return {
		kind: "tool-selection-eval",
		generatedAt: new Date().toISOString(),
		predictionMode: process.env.PI_TOOL_SELECTION_EVAL_COMMAND
			? "model-command"
			: predictionsPath
				? "predictions-file"
				: "static-fixture-baseline",
		modelCommand: process.env.PI_TOOL_SELECTION_EVAL_COMMAND
			? "set"
			: undefined,
		contractTokenEstimate,
		contractTokenByTool,
		thresholds: {
			positiveExactToolAccuracy: 0.9,
			negativeNoToolPrecision: 0.9,
			invocationExactArgAccuracy: 0.9,
			criticalConfusions: 0,
			contractTokenBudget: 1080,
		},
		metrics: {
			total: rows.length,
			passed: rows.filter((row) => row.passed).length,
			failed: rows.filter((row) => !row.passed).length,
			positiveAccuracy,
			negativePrecision,
			invocationAccuracy,
			invocationScorable: invocationScorable.length,
			invocationPassed: invocationScorable.filter((row) => row.argsPassed).length,
			criticalConfusions: criticalConfusions.length,
		},
		confusionMatrix: confusionMatrix(rows),
		perFixture: rows.map((row) => ({
			id: row.id,
			expectedTool: row.expectedTool,
			passed: row.passed,
			scorableArgs: row.scorableArgs,
			argsPassed: row.argsPassed,
		})),
		failures: rows.filter((row) => !row.passed),
		invocationFailures: invocationScorable
			.filter((row) => !row.argsPassed)
			.map((row) => ({
				id: row.id,
				expected: row.expectedDiscriminators,
				actual: pick(row.actualArgs, Object.keys(row.expectedDiscriminators)),
			})),
		criticalConfusions,
	};
}

function isCriticalConfusion(row) {
	const prompt = String(row.prompt).toLowerCase();
	const tags = row.tags.join(" ");
	if (
		["web_scrape", "web_extract"].includes(row.actualTool) &&
		/multi-source|citations/u.test([prompt, tags].join(" "))
	)
		return true;
	if (
		["web_scrape", "web_extract", "web_crawl"].includes(row.actualTool) &&
		/research|recent articles|open-ended/u.test([prompt, tags].join(" ")) &&
		!/https?:\/\//u.test(prompt)
	)
		return true;
	if (
		row.expectedTool === "web_extract" &&
		/vertical|known-site|typed|github|npm|deepwiki/u.test([prompt, tags].join(" ")) &&
		row.actualArgs?.action === "adhoc"
	)
		return true;
	if (
		row.actualTool === "web_map" &&
		/reading pages|extract page|read-pages/u.test([prompt, tags].join(" "))
	)
		return true;
	return false;
}

function confusionMatrix(rows) {
	const matrix = {};
	for (const row of rows) {
		const expected = row.expectedTool ?? "none";
		const actual = row.actualTool ?? "none";
		matrix[expected] ??= {};
		matrix[expected][actual] = (matrix[expected][actual] ?? 0) + 1;
	}
	return matrix;
}

function renderMarkdown(report) {
	const m = report.metrics;
	const failures = gateFailures(report);
	const multi = (report.runs ?? 1) > 1;
	const ranges = report.metricRanges;
	const acc = (value, key) =>
		multi && ranges?.[key]
			? `${pct(value)} (range ${pct(ranges[key][0])}–${pct(ranges[key][1])})`
			: pct(value);
	const lines = ["# tool-selection eval", "", `Generated: ${String(report.generatedAt)}`, `Mode: ${String(report.predictionMode)}`];
	if (multi) lines.push(`Runs: ${String(report.runs)} (gate on mean)`);
	lines.push(
		`Contract estimate: ${String(report.contractTokenEstimate)} tokens (budget ${String(report.thresholds.contractTokenBudget)})`,
		"",
		"## Summary",
		"",
		`Verdict: ${failures.length === 0 ? "PASS" : "FAIL"}`,
		`Positive exact tool accuracy: ${acc(m.positiveAccuracy, "positiveAccuracy")}`,
		`Negative no-tool precision: ${acc(m.negativePrecision, "negativePrecision")}`,
		`Invocation exact-arg accuracy: ${acc(m.invocationAccuracy, "invocationAccuracy")} (~${String(Math.round(m.invocationScorable))} scorable)`,
		`Critical confusions: ${multi ? m.criticalConfusions.toFixed(1) : String(m.criticalConfusions)}`,
		"",
		"## Contract tokens by tool",
		"",
		report.contractTokenByTool.map((entry) => `- ${String(entry.name)}: ${String(entry.tokens)}`).join("\n"),
		"",
		"## Gate failures",
		"",
		failures.length > 0 ? failures.map((line) => `- ${line}`).join("\n") : "None.",
	);
	if (multi) {
		lines.push(
			"",
			`## Flaky selection (< 100% across ${String(report.runs)} runs)`,
			"",
			report.flakySelection.length > 0
				? report.flakySelection.map((f) => `- ${String(f.id)}: ${pct(f.passRate)}`).join("\n")
				: "None.",
			"",
			"## Flaky invocation",
			"",
			report.flakyInvocation.length > 0
				? report.flakyInvocation.map((f) => `- ${String(f.id)}: ${pct(f.passRate)}`).join("\n")
				: "None.",
		);
	} else {
		lines.push(
			"",
			"## Selection failures",
			"",
			report.failures.length > 0
				? report.failures
						.map((row) => `- ${String(row.id)}: expected ${String(row.expectedTool ?? "none")}, got ${String(row.actualTool ?? "none")}`)
						.join("\n")
				: "None.",
			"",
			"## Invocation failures",
			"",
			report.invocationFailures.length > 0
				? report.invocationFailures
						.map((row) => `- ${String(row.id)}: expected ${JSON.stringify(row.expected)}, got ${JSON.stringify(row.actual)}`)
						.join("\n")
				: "None.",
		);
	}
	return lines.join("\n");
}

function resolveRuns(args) {
	const raw = valueFlag(args, "--runs") ?? process.env.PI_TOOL_SELECTION_RUNS;
	const n = Number.parseInt(String(raw ?? "1"), 10);
	return Number.isFinite(n) && n > 0 ? n : 1;
}

function aggregateReports(reports) {
	const runs = reports.length;
	const base = reports[0];
	const mean = (selectMetric) => reports.reduce((sum, r) => sum + selectMetric(r), 0) / runs;
	const range = (selectMetric) => [
		Math.min(...reports.map(selectMetric)),
		Math.max(...reports.map(selectMetric)),
	];
	const flakySelection = [];
	const flakyInvocation = [];
	for (const { id } of base.perFixture) {
		const samples = reports.map((r) => r.perFixture.find((f) => f.id === id));
		if (samples[0].expectedTool !== null) {
			const rate = samples.filter((f) => f.passed).length / runs;
			if (rate < 1) flakySelection.push({ id, passRate: rate });
		}
		const scorable = samples.filter((f) => f.scorableArgs);
		if (scorable.length > 0) {
			const rate = scorable.filter((f) => f.argsPassed).length / scorable.length;
			if (rate < 1) flakyInvocation.push({ id, passRate: rate });
		}
	}
	return {
		...base,
		runs,
		metrics: {
			total: base.metrics.total,
			positiveAccuracy: mean((r) => r.metrics.positiveAccuracy),
			negativePrecision: mean((r) => r.metrics.negativePrecision),
			invocationAccuracy: mean((r) => r.metrics.invocationAccuracy),
			invocationScorable: mean((r) => r.metrics.invocationScorable),
			invocationPassed: mean((r) => r.metrics.invocationPassed),
			criticalConfusions: mean((r) => r.metrics.criticalConfusions),
		},
		metricRanges: {
			positiveAccuracy: range((r) => r.metrics.positiveAccuracy),
			negativePrecision: range((r) => r.metrics.negativePrecision),
			invocationAccuracy: range((r) => r.metrics.invocationAccuracy),
		},
		perRunMetrics: reports.map((r) => ({
			positiveAccuracy: r.metrics.positiveAccuracy,
			invocationAccuracy: r.metrics.invocationAccuracy,
			criticalConfusions: r.metrics.criticalConfusions,
		})),
		flakySelection,
		flakyInvocation,
		failures: [],
		invocationFailures: [],
	};
}

function discriminatorArgs(expectedArgs) {
	const out = {};
	for (const key of DISCRIMINATOR_ARG_KEYS)
		if (expectedArgs?.[key] !== undefined) out[key] = expectedArgs[key];
	return out;
}

function argsMatch(expected, actual, keys) {
	return keys.every((key) => {
		if (FREE_FORM_ARG_KEYS.has(key)) return isNonEmpty(actual?.[key]);
		return JSON.stringify(actual?.[key]) === JSON.stringify(expected[key]);
	});
}

function isNonEmpty(value) {
	if (Array.isArray(value)) return value.length > 0;
	return value !== undefined && value !== null && value !== "";
}

function pick(source, keys) {
	const out = {};
	for (const key of keys) out[key] = source?.[key];
	return out;
}

function pct(value) {
	return `${(value * 100).toFixed(1)}%`;
}

function gateFailures(report) {
	const { metrics: m, thresholds: t } = report;
	const failures = [];
	if (m.positiveAccuracy < t.positiveExactToolAccuracy)
		failures.push(
			`positive tool accuracy ${pct(m.positiveAccuracy)} < ${pct(t.positiveExactToolAccuracy)}`,
		);
	if (m.negativePrecision < t.negativeNoToolPrecision)
		failures.push(
			`negative no-tool precision ${pct(m.negativePrecision)} < ${pct(t.negativeNoToolPrecision)}`,
		);
	if (m.invocationAccuracy < t.invocationExactArgAccuracy)
		failures.push(
			`invocation arg accuracy ${pct(m.invocationAccuracy)} < ${pct(t.invocationExactArgAccuracy)}`,
		);
	if (m.criticalConfusions > t.criticalConfusions)
		failures.push(`critical confusions ${String(m.criticalConfusions)} > ${String(t.criticalConfusions)}`);
	if (report.contractTokenEstimate > t.contractTokenBudget)
		failures.push(
			`contract tokens ${String(report.contractTokenEstimate)} > budget ${String(t.contractTokenBudget)}`,
		);
	return failures;
}

function enforceThresholds(report) {
	const failures = gateFailures(report);
	if (failures.length === 0) {
		console.log("\nVERDICT: PASS");
		return;
	}
	console.error("\nVERDICT: FAIL");
	for (const line of failures) console.error(`  - ${line}`);
	process.exitCode = 1;
}

function ratio(numerator, denominator) {
	return denominator === 0 ? 1 : numerator / denominator;
}

function valueFlag(args, name) {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}
