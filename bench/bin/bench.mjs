#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { intFlag } from "../lib/cli-args.mjs";
import { runEval } from "../lib/runner.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const positionalFirst = args.find((arg) => !arg.startsWith("--"));
const corpusPath = path.resolve(rootDir, positionalFirst ?? "eval/corpus.json");
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
