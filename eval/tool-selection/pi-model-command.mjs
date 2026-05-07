#!/usr/bin/env node
/**
 * @fileoverview Pi-backed model command for tool-selection evals.
 *
 * Design: the eval runner expects a Unix filter: JSON on stdin, prediction JSON
 * on stdout. This wrapper isolates Pi CLI chatter/parsing so the runner can use
 * the same PI_TOOL_SELECTION_EVAL_COMMAND hook as other model providers.
 * Performance: one Pi call per eval suite; keep prompt compact and disable tools.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const inputText = await readStdin();
const input = parseInput(inputText);
const toolNames = input.tools.map((tool) => tool.name);
const prompt = buildPrompt(input, toolNames);
const result = spawnSync(piBinary(), piArgs(prompt), {
	cwd: process.cwd(),
	encoding: "utf8",
	maxBuffer: 20 * 1024 * 1024,
});

if (result.status !== 0) {
	process.stderr.write(result.stderr || result.stdout || "pi command failed");
	process.exit(result.status ?? 1);
}

const predictions = parsePredictionEnvelope(result.stdout);
if (!predictions) {
	process.stderr.write(
		`Pi did not return prediction JSON. Raw stdout:\n${result.stdout}\nRaw stderr:\n${result.stderr}`,
	);
	process.exit(1);
}

process.stdout.write(`${JSON.stringify(normalizePredictions(predictions))}\n`);

function readStdin() {
	return new Promise((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", reject);
	});
}

function parseInput(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(
			`Expected eval JSON on stdin: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function buildPrompt(input, toolNames) {
	return `You are evaluating pi-scraper tool selection.
Choose at most one tool for each fixture. Do not execute tools.
Choose by user intent even when a fixture says "this site", "this page", "homepage", or "arbitrary page" without an explicit URL.
Use null for multi-source search/research, open-ended research, or unrelated prompts.
Return ONLY valid JSON, no markdown, in this shape:
{"predictions":[{"id":"fixture id","actualTool":"${toolNames.join(" | ")} | null","actualArgs":{}}]}

Routing cues:
- web_scrape: read/fetch/extract one URL page.
- web_summarize: summarize one URL or provided page content; not multi-source research.
- web_crawl: crawl/follow links, read pages, depth, crawl status/list/resume.
- web_map: robots/sitemaps/llms URL discovery only; no page body reading.
- web_batch: multiple independent URLs and per-URL failures.
- web_diff: compare a URL/page with a saved snapshot.
- web_extract: vertical deterministic known-site/docsite extraction, arbitrary adhoc JSON/schema extraction, regex, excerpts, markers.
- web_get_result: retrieve responseId or jobId.
For web_extract actualArgs.action: vertical for deterministic docs/docsite/MDN/Docusaurus/GitHub/npm known-site pages; pattern for regex/excerpts/markers; adhoc only for arbitrary custom schema extraction; list for listing extractors.

Eval input JSON:
${JSON.stringify(input)}`;
}

function piBinary() {
	return process.env.PI_TOOL_SELECTION_PI_BIN || "pi";
}

function piArgs(prompt) {
	const args = [
		"--no-tools",
		"--no-extensions",
		"--no-skills",
		"--no-context-files",
		"--no-session",
		"--mode",
		"text",
	];
	if (process.env.PI_TOOL_SELECTION_PI_PROVIDER)
		args.push("--provider", process.env.PI_TOOL_SELECTION_PI_PROVIDER);
	if (process.env.PI_TOOL_SELECTION_PI_MODEL)
		args.push("--model", process.env.PI_TOOL_SELECTION_PI_MODEL);
	args.push("-p", prompt);
	return args;
}

function parsePredictionEnvelope(stdout) {
	const direct = parseJsonLoose(stdout);
	if (isPredictionEnvelope(direct)) return direct;
	if (typeof direct?.response === "string") {
		const nested = parseJsonLoose(direct.response);
		if (isPredictionEnvelope(nested)) return nested;
	}
	if (typeof direct?.text === "string") {
		const nested = parseJsonLoose(direct.text);
		if (isPredictionEnvelope(nested)) return nested;
	}
	if (typeof direct?.content === "string") {
		const nested = parseJsonLoose(direct.content);
		if (isPredictionEnvelope(nested)) return nested;
	}
	return undefined;
}

function parseJsonLoose(text) {
	if (typeof text !== "string") return text;
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1].trim() : trimmed;
	try {
		return JSON.parse(candidate);
	} catch {}
	return parseDelimitedJson(candidate, "{", "}") ?? parseDelimitedJson(candidate, "[", "]");
}

function parseDelimitedJson(text, open, close) {
	const start = text.indexOf(open);
	const end = text.lastIndexOf(close);
	if (start < 0 || end <= start) return undefined;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

function isPredictionEnvelope(value) {
	return Array.isArray(value) || Array.isArray(value?.predictions);
}

function normalizePredictions(value) {
	const predictions = Array.isArray(value) ? value : value.predictions;
	return {
		predictions: predictions.map((prediction) => ({
			id: prediction.id,
			actualTool: prediction.actualTool ?? null,
			actualArgs:
				prediction.actualArgs && typeof prediction.actualArgs === "object"
					? prediction.actualArgs
					: {},
		})),
	};
}
