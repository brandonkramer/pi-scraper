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
for (const tool of tools) {
	const json = JSON.stringify({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	});
	total += approxTokens(json.length);
}
console.log(`METRIC contract_tokens=${total}`);
console.log(`METRIC tool_count=${tools.length}`);
