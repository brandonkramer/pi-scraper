#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { intFlag } from "./harness/cli-args.mjs";
import { runEval } from "./harness/eval-runner-core.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const corpusPath = path.resolve(rootDir, positional[0] ?? "eval/corpus.json");
const warmup = intFlag(args, "warmup", 3);
const repeats = intFlag(args, "repeats", 20);

runEval({ rootDir, corpusPath, warmup, repeats })
	.then(({ markdown, failed }) => {
		console.log(markdown);
		process.exitCode = failed ? 1 : 0;
	})
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
