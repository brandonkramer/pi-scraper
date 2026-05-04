#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { intFlag } from "../../lib/cli-args.mjs";
import { timedRepeats } from "../../lib/stats.mjs";
import { writeSuiteReport } from "../../lib/results.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const args = process.argv.slice(2);
const warmup = intFlag(args, "warmup", 3);
const repeats = intFlag(args, "repeats", 20);
const outDir = path.join(rootDir, "bench/.build/tool-registration");
const runnerPath = path.join(outDir, "register-once.mjs");

await buildExtension({ rootDir, outDir });
await writeRunner({ outDir, runnerPath });
const sample = runOnce(runnerPath);
const perf = await timedRepeats(() => runOnce(runnerPath), { warmup, repeats });

const report = {
	kind: "cold-tool-registration",
	generatedAt: new Date().toISOString(),
	nodeVersion: process.version,
	modeFlags: { warmup, repeats },
	registration: sample,
	perf,
};
const markdown = renderMarkdown(report);
await writeReport({ rootDir, report, markdown });
console.log(markdown);

async function buildExtension({ rootDir, outDir }) {
	const marker = path.join(outDir, ".built-at");
	const sourceMtime = await maxMtime(path.join(rootDir, "src"));
	const markerMtime = await mtimeMs(marker);
	if (markerMtime !== undefined && markerMtime >= sourceMtime) return;
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
			"src/index.ts",
		],
		{ cwd: rootDir, stdio: "pipe" },
	);
	await writeFile(marker, "");
}

async function writeRunner({ outDir, runnerPath }) {
	const entryUrl = pathToFileURL(path.join(outDir, "index.js")).toString();
	await writeFile(
		runnerPath,
		`const started = performance.now();\nconst mod = await import(${JSON.stringify(entryUrl)});\nlet tools = 0;\nlet commands = 0;\nlet handlers = 0;\nconst pi = {\n  registerTool(tool) { if (!tool?.name) throw new Error('missing tool name'); tools += 1; },\n  registerCommand(name, command) { if (!name || !command) throw new Error('missing command registration'); commands += 1; },\n  on(event, handler) { if (!event || typeof handler !== 'function') throw new Error('invalid handler'); handlers += 1; },\n};\nmod.default(pi);\nconsole.log(JSON.stringify({ tools, commands, handlers, durationMs: Math.round((performance.now() - started) * 100) / 100 }));\n`,
	);
}

function runOnce(runnerPath) {
	const output = execFileSync(process.execPath, [runnerPath], {
		cwd: rootDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return JSON.parse(output.trim());
}

async function writeReport({ rootDir, report, markdown }) {
	await writeSuiteReport({
		rootDir,
		suite: "tool-registration",
		kind: undefined,
		timestamp: report.generatedAt,
		report,
		markdown,
	});
}

function renderMarkdown(report) {
	const p = report.perf;
	return [
		"# cold Pi tool-registration benchmark",
		"",
		`Generated: ${report.generatedAt} · Node: ${report.nodeVersion} · warmup ${report.modeFlags.warmup} × repeats ${report.modeFlags.repeats}`,
		"",
		"## Registration sample",
		"",
		`Tools: ${report.registration.tools} · Commands: ${report.registration.commands} · Session handlers: ${report.registration.handlers}`,
		"",
		"## Cold process import + register time",
		"",
		"| Samples | Min ms | Median ms | Mean ms | P95 ms | Max ms | Stddev ms |",
		"| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		`| ${p.samples} | ${p.min_ms} | ${p.median_ms} | ${p.mean_ms} | ${p.p95_ms} | ${p.max_ms} | ${p.stddev_ms} |`,
		"",
		"Measured command: a fresh Node process imports the compiled extension, registers all tools/commands/session handlers against a stub Pi registrar, prints counts, and exits.",
	].join("\n");
}

async function maxMtime(dir) {
	let max = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			max = Math.max(max, await maxMtime(full));
		} else if (entry.isFile() && /\.(ts|json)$/u.test(entry.name)) {
			max = Math.max(max, (await stat(full)).mtimeMs);
		}
	}
	return max;
}

async function mtimeMs(file) {
	try {
		return (await stat(file)).mtimeMs;
	} catch {
		return undefined;
	}
}
