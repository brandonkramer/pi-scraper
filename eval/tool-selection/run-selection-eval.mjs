#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "../..");
await main();

async function main() {
	const args = process.argv.slice(2);
	const predictionsPath = valueFlag(args, "--predictions");
	const outDir =
		valueFlag(args, "--out-dir") ??
		path.join(rootDir, "bench/results/tool-selection");
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
	const report = buildReport({ contracts, fixtures, predictions });
	const markdown = renderMarkdown(report);
	await mkdir(outDir, { recursive: true });
	await writeFile(
		path.join(outDir, "latest.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	await writeFile(path.join(outDir, "latest.md"), `${markdown}\n`);
	console.log(markdown);
	console.log(`\nJSON: ${path.join(outDir, "latest.json")}`);
}

async function loadWebTools() {
	const outDir = path.join(rootDir, "bench/.build/tool-selection-eval");
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
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
			"--skipLibCheck",
			"--types",
			"node",
			"src/env.d.ts",
			"src/tools/register.ts",
		],
		{ cwd: rootDir, stdio: "pipe" },
	);
	const mod = await import(
		pathToFileURL(path.join(outDir, "tools/register.js"))
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
			throw new Error(result.stderr || "model command failed");
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

function buildReport({ contracts, fixtures, predictions }) {
	const byId = new Map(
		predictions.map((prediction) => [prediction.id, prediction]),
	);
	const rows = fixtures.map((fixture) => {
		const prediction = byId.get(fixture.id) ?? {
			id: fixture.id,
			actualTool: null,
		};
		return {
			id: fixture.id,
			prompt: fixture.prompt,
			expectedTool: fixture.expectedTool,
			actualTool: prediction.actualTool ?? null,
			actualArgs: prediction.actualArgs ?? {},
			passed: (prediction.actualTool ?? null) === fixture.expectedTool,
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
		contractTokenEstimate: contracts.reduce(
			(sum, contract) => sum + Math.ceil(JSON.stringify(contract).length / 4),
			0,
		),
		thresholds: {
			positiveExactToolAccuracy: 0.9,
			negativeNoToolPrecision: 0.9,
			criticalConfusions: 0,
		},
		metrics: {
			total: rows.length,
			passed: rows.filter((row) => row.passed).length,
			failed: rows.filter((row) => !row.passed).length,
			positiveAccuracy,
			negativePrecision,
			criticalConfusions: criticalConfusions.length,
		},
		confusionMatrix: confusionMatrix(rows),
		failures: rows.filter((row) => !row.passed),
		criticalConfusions,
	};
}

function isCriticalConfusion(row) {
	const prompt = String(row.prompt).toLowerCase();
	const tags = row.tags.join(" ");
	if (
		["web_scrape", "web_summarize"].includes(row.actualTool) &&
		/multi-source|citations/u.test([prompt, tags].join(" "))
	)
		return true;
	if (
		["web_scrape", "web_summarize", "web_crawl"].includes(row.actualTool) &&
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
	return [
		"# tool-selection eval",
		"",
		`Generated: ${String(report.generatedAt)}`,
		`Mode: ${String(report.predictionMode)}`,
		`Contract estimate: ${String(report.contractTokenEstimate)} tokens`,
		"",
		"## Summary",
		"",
		`Passed: ${String(report.metrics.passed)}/${String(report.metrics.total)}`,
		`Positive exact tool accuracy: ${(report.metrics.positiveAccuracy * 100).toFixed(1)}%`,
		`Negative no-tool precision: ${(report.metrics.negativePrecision * 100).toFixed(1)}%`,
		`Critical confusions: ${String(report.metrics.criticalConfusions)}`,
		"",
		"## Failures",
		"",
		report.failures.length > 0
			? report.failures
					.map(
						(row) =>
							`- ${String(row.id)}: expected ${String(row.expectedTool ?? "none")}, got ${String(row.actualTool ?? "none")}`,
					)
					.join("\n")
			: "None.",
	].join("\n");
}

function ratio(numerator, denominator) {
	return denominator === 0 ? 1 : numerator / denominator;
}

function valueFlag(args, name) {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}
