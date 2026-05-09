#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const outDir = path.join(rootDir, "bench/.build/tool-contract-eval");
const args = process.argv.slice(2);
const focused = valueList(args, "--focused") ?? [
	"web_scrape",
	"web_crawl",
	"web_extract",
];
const runEmpirical = flag(args, "--empirical");

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

const mod = await import(pathToFileURL(path.join(outDir, "tools/register.js")));
const tools = mod.webTools;
const approxTokens = (chars) => Math.ceil(chars / 4);

const report = await buildStaticTokenReport(tools);
printStaticMetrics(report);
if (runEmpirical) {
	try {
		printEmpiricalMetrics(measureEmpiricalOverhead(tools));
	} catch (error) {
		console.error(
			`EMPIRICAL_ERROR: ${error instanceof Error ? error.message : String(error)}`,
		);
		console.error(
			"Note: Empirical measurement requires a provider/model that returns token counts in JSON mode.",
		);
	}
}

async function buildStaticTokenReport(tools) {
	let descriptionTokens = 0;
	let contractTokens = 0;
	const perTool = new Map();
	for (const tool of tools) {
		const description = String(tool.description ?? "");
		const contract = JSON.stringify({
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: tool.parameters,
		});
		const tokens = {
			description: approxTokens(description.length),
			contract: approxTokens(contract.length),
		};
		perTool.set(tool.name, tokens);
		descriptionTokens += tokens.description;
		contractTokens += tokens.contract;
	}
	const skillDescription = await readSkillDescription();
	const skillDescriptionTokens = approxTokens(skillDescription.length);
	return {
		descriptionTokens,
		contractTokens,
		skillDescriptionTokens,
		combinedDescriptionTokens: descriptionTokens + skillDescriptionTokens,
		perTool,
	};
}

async function readSkillDescription() {
	const skillPath = path.join(rootDir, "skills/web-scraping/SKILL.md");
	const text = await readFile(skillPath, "utf8");
	const frontmatter = text.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
	const match = frontmatter.match(/^description:\s*(.*)$/mu);
	return stripYamlString(match?.[1] ?? "");
}

function stripYamlString(value) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function printStaticMetrics(report) {
	const focusDescriptionTotal = sumFocused(report.perTool, "description");
	const focusContractTotal = sumFocused(report.perTool, "contract");
	console.log(`METRIC description_tokens=${report.descriptionTokens}`);
	console.log(
		`METRIC skill_description_tokens=${report.skillDescriptionTokens}`,
	);
	console.log(
		`METRIC combined_description_tokens=${report.combinedDescriptionTokens}`,
	);
	console.log(`METRIC focus_description_tokens=${focusDescriptionTotal}`);
	console.log(`METRIC focus_contract_tokens=${focusContractTotal}`);
	console.log(`METRIC contract_tokens=${report.contractTokens}`);
	console.log(`METRIC full_contract_tokens=${report.contractTokens}`);
	for (const tool of tools) {
		const tokens = report.perTool.get(tool.name) ?? {
			description: 0,
			contract: 0,
		};
		const metricName = tool.name.slice(4);
		console.log(
			`METRIC ${metricName}_description_tokens=${tokens.description}`,
		);
		console.log(`METRIC ${metricName}_contract_tokens=${tokens.contract}`);
	}
	console.log(`METRIC tool_count=${tools.length}`);
}

function sumFocused(perTool, key) {
	return focused.reduce(
		(sum, name) => sum + (perTool.get(name)?.[key] ?? 0),
		0,
	);
}

function measureEmpiricalOverhead(tools) {
	const toolNames = tools.map((tool) => tool.name);
	const baseline = runPiMeasurement({ toolNames: [] });
	const allTools = runPiMeasurement({ toolNames });
	const perTool = new Map();
	for (const name of toolNames) {
		const result = runPiMeasurement({ toolNames: [name] });
		perTool.set(name, result.inputTokens - baseline.inputTokens);
	}
	return { baseline, allTools, perTool, toolNames };
}

function runPiMeasurement({ toolNames }) {
	const result = spawnSync(piBinary(), piArgs(toolNames), {
		cwd: rootDir,
		encoding: "utf8",
		maxBuffer: 20 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || "pi measurement failed");
	}
	const parsed = parseJsonLoose(result.stdout);
	const inputTokens = findInputTokens(parsed);
	if (!Number.isFinite(inputTokens)) {
		throw new Error(
			`Could not find input token usage in Pi JSON output:\n${result.stdout}`,
		);
	}
	return { inputTokens };
}

function piArgs(toolNames) {
	const prompt =
		process.env.PI_TOOL_CONTRACT_PROMPT ??
		"Reply with exactly OK. Do not call tools.";
	const args = [
		"--no-skills",
		"--no-context-files",
		"--no-session",
		"--mode",
		"json",
	];
	if (toolNames.length === 0) {
		args.push("--no-tools", "--no-extensions");
	} else {
		args.push(
			"--no-builtin-tools",
			"--no-extensions",
			"--extension",
			path.join(rootDir, "src/index.ts"),
			"--tools",
			toolNames.join(","),
		);
	}
	if (process.env.PI_TOOL_CONTRACT_PROVIDER) {
		args.push("--provider", process.env.PI_TOOL_CONTRACT_PROVIDER);
	}
	if (process.env.PI_TOOL_CONTRACT_MODEL) {
		args.push("--model", process.env.PI_TOOL_CONTRACT_MODEL);
	}
	args.push("-p", prompt);
	return args;
}

function piBinary() {
	return process.env.PI_TOOL_CONTRACT_PI_BIN || "pi";
}

function printEmpiricalMetrics(report) {
	const baseline = report.baseline.inputTokens;
	const allTools = report.allTools.inputTokens;
	console.log(`METRIC empirical_baseline_input_tokens=${baseline}`);
	console.log(`METRIC empirical_tools_input_tokens=${allTools}`);
	console.log(`METRIC input_overhead_tokens=${allTools - baseline}`);
	for (const name of report.toolNames) {
		const overhead = report.perTool.get(name);
		if (overhead !== undefined) {
			console.log(`METRIC ${name.slice(4)}_input_overhead_tokens=${overhead}`);
		}
	}
}

function parseJsonLoose(text) {
	try {
		return JSON.parse(text);
	} catch {}
	const lines = text.trim().split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (!line) continue;
		try {
			return JSON.parse(line);
		} catch {}
	}
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
	throw new Error(`Expected Pi JSON output, got:\n${text}`);
}

function findInputTokens(value) {
	const queue = [value];
	while (queue.length) {
		const current = queue.shift();
		if (!current || typeof current !== "object") continue;
		for (const [key, nested] of Object.entries(current)) {
			if (isInputTokenKey(key) && typeof nested === "number") return nested;
			if (isTotalTokenKey(key) && typeof nested === "number") return nested;
			if (nested && typeof nested === "object") queue.push(nested);
		}
	}
	return undefined;
}

function isInputTokenKey(key) {
	return /^(input|prompt)[_-]?tokens?$/iu.test(key);
}

function isTotalTokenKey(key) {
	return /^total[t_-]?tokens$/iu.test(key);
}

function valueList(args, flagName) {
	const index = args.indexOf(flagName);
	if (index < 0) return undefined;
	return (args[index + 1] ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function flag(args, flagName) {
	return args.includes(flagName);
}
