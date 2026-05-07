#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const outDir = path.join(rootDir, "bench/.build/tool-contract-eval");

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

const mod = await import(path.join(outDir, "tools/register.js"));
const tools = mod.webTools;
const approxTokens = (chars) => Math.ceil(chars / 4);

let total = 0;
const perTool = new Map();
for (const tool of tools) {
	const json = JSON.stringify({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	});
	const tokens = approxTokens(json.length);
	perTool.set(tool.name, tokens);
	total += tokens;
}
const focused = ["web_scrape", "web_crawl", "web_extract"];
const focusTotal = focused.reduce(
	(sum, name) => sum + (perTool.get(name) ?? 0),
	0,
);
console.log(`METRIC focus_contract_tokens=${focusTotal}`);
console.log(`METRIC contract_tokens=${total}`);
for (const name of focused) {
	console.log(`METRIC ${name.slice(4)}_tokens=${perTool.get(name) ?? 0}`);
}
console.log(`METRIC tool_count=${tools.length}`);
