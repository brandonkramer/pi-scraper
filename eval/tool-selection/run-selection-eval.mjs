#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "../..");
const DISCRIMINATOR_ARG_KEYS = ["action", "task", "extractor", "format", "jsonPaths"];
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
	const predictions = await loadPredictions({
		predictionsPath,
		contracts,
		fixtures,
	});
	const report = buildReport({ contracts, fixtures, predictions, predictionsPath });
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
		// Invocation is only scorable once the tool itself is right and the fixture
		// pins at least one discriminator arg (action/task/extractor/format/jsonPaths).
		const scorableArgs = passed && Object.keys(expectedDiscriminators).length > 0;
		const argsPassed = scorableArgs && argsMatch(expectedDiscriminators, actualArgs);
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
	return [
		"# tool-selection eval",
		"",
		`Generated: ${String(report.generatedAt)}`,
		`Mode: ${String(report.predictionMode)}`,
		`Contract estimate: ${String(report.contractTokenEstimate)} tokens (budget ${String(report.thresholds.contractTokenBudget)})`,
		"",
		"## Summary",
		"",
		`Verdict: ${failures.length === 0 ? "PASS" : "FAIL"}`,
		`Passed: ${String(m.passed)}/${String(m.total)}`,
		`Positive exact tool accuracy: ${pct(m.positiveAccuracy)}`,
		`Negative no-tool precision: ${pct(m.negativePrecision)}`,
		`Invocation exact-arg accuracy: ${pct(m.invocationAccuracy)} (${String(m.invocationPassed)}/${String(m.invocationScorable)} scorable)`,
		`Critical confusions: ${String(m.criticalConfusions)}`,
		"",
		"## Contract tokens by tool",
		"",
		report.contractTokenByTool
			.map((entry) => `- ${String(entry.name)}: ${String(entry.tokens)}`)
			.join("\n"),
		"",
		"## Gate failures",
		"",
		failures.length > 0 ? failures.map((line) => `- ${line}`).join("\n") : "None.",
		"",
		"## Selection failures",
		"",
		report.failures.length > 0
			? report.failures
					.map(
						(row) =>
							`- ${String(row.id)}: expected ${String(row.expectedTool ?? "none")}, got ${String(row.actualTool ?? "none")}`,
					)
					.join("\n")
			: "None.",
		"",
		"## Invocation failures",
		"",
		report.invocationFailures.length > 0
			? report.invocationFailures
					.map(
						(row) =>
							`- ${String(row.id)}: expected ${JSON.stringify(row.expected)}, got ${JSON.stringify(row.actual)}`,
					)
					.join("\n")
			: "None.",
	].join("\n");
}

function discriminatorArgs(expectedArgs) {
	const out = {};
	for (const key of DISCRIMINATOR_ARG_KEYS)
		if (expectedArgs?.[key] !== undefined) out[key] = expectedArgs[key];
	return out;
}

function argsMatch(expected, actual) {
	return Object.entries(expected).every(
		([key, value]) => JSON.stringify(actual?.[key]) === JSON.stringify(value),
	);
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
