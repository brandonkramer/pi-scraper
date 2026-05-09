#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const suitesDir = path.join(rootDir, "bench/suites");

const suites = {
	"dom capture": ["dom-adapters/capture-fixtures.mjs"],
	"dom diff": ["dom-adapters/diff-stability.mjs"],
	"dom memory": ["dom-adapters/memory.mjs", { nodeArgs: ["--expose-gc"] }],
	"dom prototype": ["dom-adapters/prototype.mjs"],
	"dom quality": ["dom-adapters/quality.mjs"],
	"dom timing": ["dom-adapters/timing.mjs"],
	"extractors compare": ["extractors/compare.mjs"],
	"install-smoke": ["install-smoke/smoke.mjs"],
	"parsers linkedom": ["parsers/profile-linkedom.mjs"],
	"serializers compare": ["serializers/compare.mjs"],
	"serializers markdown": ["serializers/profile-turndown.mjs"],
	"tool-contract tokens": ["tool-contract/tokens.mjs"],
	"tool-registration": ["tool-registration/timing.mjs"],
};

const aliases = {
	"compare:dom": "dom quality",
	"compare:dom:batch": "dom timing",
	"compare:dom:diff": "dom diff",
	"compare:dom:memory": "dom memory",
	"compare:extract": "extractors compare",
	"compare:serialize": "serializers compare",
	"profile:linkedom": "parsers linkedom",
	"profile:markdown": "serializers markdown",
	"spike:cheerio": "dom prototype",
	"tokens:tools": "tool-contract tokens",
};

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	printUsage(args.length === 0 ? 1 : 0);
}

const { key, rest } = resolveSuite(args);
const suite = suites[key];
if (!suite) {
	console.error(`Unknown bench suite: ${args.join(" ")}`);
	printUsage(1);
}

const [script, options = {}] = suite;
const result = spawnSync(
	process.execPath,
	[...(options.nodeArgs ?? []), path.join(suitesDir, script), ...rest],
	{ cwd: rootDir, stdio: "inherit" },
);
process.exit(result.status ?? 1);

function resolveSuite(args) {
	const legacyKey = aliases[args[0]];
	if (legacyKey) return { key: legacyKey, rest: args.slice(1) };
	const twoPart = args.slice(0, 2).join(" ");
	if (suites[twoPart]) return { key: twoPart, rest: args.slice(2) };
	return { key: args[0], rest: args.slice(1) };
}

function printUsage(code) {
	console.error("Usage: npm run bench:suite -- <suite> [args...]");
	console.error("");
	console.error("Suites:");
	for (const key of Object.keys(suites).sort()) console.error(`  ${key}`);
	process.exit(code);
}
