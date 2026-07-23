#!/usr/bin/env node
/**
 * @fileoverview Tool-selection eval orchestrator: load live tool contracts +
 * fixtures, get predictions (model adapter / predictions file / static
 * baseline), score via the pure score.mjs, render markdown, enforce the gate
 * exit code. Scoring/thresholds live in score.mjs + config.mjs; this file owns
 * I/O and side effects only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { DEFAULT_RUNS } from "./config.mjs";
import { aggregateReports, buildReport, gateFailures, pct } from "./score.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");
await main();

async function main() {
	const args = process.argv.slice(2);
	const predictionsPath = valueFlag(args, "--predictions");
	const outDir = String(
		valueFlag(args, "--out-dir") ?? path.join(rootDir, "bench/results/tool-selection"),
	);
	const fixtures = await loadFixtures();
	const { tools, initialTools } = await loadWebTools();
	const contracts = tools.map((tool) => ({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	}));
	const initialContracts = initialTools.map((tool) => ({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	}));
	const deferredLoading = buildDeferredLoadingBenchmark(contracts, initialContracts);
	const predictionMode = predictionsPath
		? "predictions-file"
		: process.env.PI_TOOL_SELECTION_EVAL_COMMAND
			? "model-command"
			: "static-fixture-baseline";
	// Only the model command produces independent samples; static/predictions
	// modes are deterministic, so repeating them adds nothing. Average N model
	// runs to keep the gate verdict above per-run noise.
	const modelMode = predictionMode === "model-command";
	const runs = modelMode ? resolveRuns(args) : 1;
	const reports = [];
	for (let i = 0; i < runs; i++) {
		const predictions = await loadPredictions({ predictionsPath, contracts, fixtures });
		reports.push({
			...buildReport({ contracts, fixtures, predictions, predictionMode }),
			deferredLoading,
		});
	}
	const report = runs > 1 ? aggregateReports(reports) : reports[0];
	const markdown = renderMarkdown(report);
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(path.join(outDir, "latest.md"), `${markdown}\n`);
	console.log(markdown);
	console.log("\nJSON:", path.join(outDir, "latest.json"));
	enforceThresholds(report);
}

async function loadFixtures() {
	const dir = path.join(rootDir, "eval/tool-selection/fixtures");
	const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
	const groups = await Promise.all(
		files.map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"))),
	);
	return groups.flat();
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
	const mod = await import(pathToFileURL(path.join(outDir, "tools/infra/register.js")));
	const loaderMod = await import(pathToFileURL(path.join(outDir, "tools/web-tools.js")));
	const loader = loaderMod.createWebToolsLoader({
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: (names) => {
			void names;
		},
	});
	const initialNames = new Set(mod.initialWebToolNames);
	return {
		tools: mod.webTools,
		initialTools: [...mod.webTools.filter((tool) => initialNames.has(tool.name)), loader],
	};
}

function buildDeferredLoadingBenchmark(fullContracts, initialContracts) {
	const fullTokens = contractTokens(fullContracts);
	const initialTokens = contractTokens(initialContracts);
	return {
		fullTokens,
		initialTokens,
		reduction: fullTokens === 0 ? 0 : 1 - initialTokens / fullTokens,
		initialTools: initialContracts.map((contract) => contract.name),
	};
}

function contractTokens(contracts) {
	return contracts.reduce(
		(total, contract) => total + Math.ceil(JSON.stringify(contract).length / 4),
		0,
	);
}

async function loadPredictions({ predictionsPath, contracts, fixtures }) {
	if (predictionsPath) {
		const parsed = JSON.parse(await readFile(path.resolve(predictionsPath), "utf8"));
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
		`Initial deferred catalog: ${String(report.deferredLoading.initialTokens)} tokens (${pct(report.deferredLoading.reduction)} reduction)`,
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
	const n = Number.parseInt(String(raw ?? DEFAULT_RUNS), 10);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUNS;
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

function valueFlag(args, name) {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}
