#!/usr/bin/env node
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { intFlag, stringFlag } from "./cli-args.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).toString()) {
	const args = process.argv.slice(2);
	const keep = intFlag(args, "keep", 20);
	const resultsDir = path.resolve(rootDir, stringFlag(args, "results-dir", "bench/results"));
	const pruned = await rotateResultHistories(resultsDir, { keep });
	console.log(`Pruned ${pruned} result history file(s).`);
}

export async function rotateResultHistories(resultsDir, { keep = 20 } = {}) {
	let pruned = 0;
	for (const historyDir of await findHistoryDirs(resultsDir)) {
		const entries = (await readdir(historyDir, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => entry.name)
			.toSorted()
			.toReversed();
		for (const name of entries.slice(keep)) {
			await rm(path.join(historyDir, name), { force: true });
			pruned += 1;
		}
	}
	return pruned;
}

async function findHistoryDirs(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const full = path.join(dir, entry.name);
		if (!entry.isDirectory()) continue;
		if (entry.name === "history") out.push(full);
		else out.push(...(await findHistoryDirs(full)));
	}
	return out;
}
