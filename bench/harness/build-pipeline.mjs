import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Single TypeScript entrypoint; tsc follows imports for the rest of the pipeline.
// Keep in sync with src/scrape/pipeline.ts (rename or split there → update here).
const PIPELINE_ENTRY = "src/scrape/pipeline.ts";
const DECLARATION_ENTRIES = ["src/env.d.ts"];

export async function buildAndImport(rootDir) {
	const outDir = path.join(rootDir, "bench/.eval-runner-build");
	const marker = path.join(outDir, ".built-at");
	const sourceMtime = await maxMtime(path.join(rootDir, "src"));
	const markerMtime = await mtimeMs(marker);
	if (markerMtime === undefined || markerMtime < sourceMtime) {
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
				...DECLARATION_ENTRIES,
				PIPELINE_ENTRY,
			],
			{ cwd: rootDir, stdio: "pipe" },
		);
		await writeFile(marker, "");
	}
	const pipeline = await import(
		pathToFileURL(path.join(outDir, "scrape/pipeline.js")).toString()
	);
	const markdown = await import(
		pathToFileURL(path.join(outDir, "serialize/markdown.js")).toString()
	);
	const fast = await import(
		pathToFileURL(path.join(outDir, "parse/fast.js")).toString()
	);
	return {
		scrapeUrl: pipeline.scrapeUrl,
		htmlToMarkdown: markdown.htmlToMarkdown,
		extractFastPage: fast.extractFastPage,
	};
}

async function maxMtime(dir) {
	let max = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			max = Math.max(max, await maxMtime(full));
		} else if (
			entry.isFile() &&
			/\.(ts|json)$/u.test(entry.name) &&
			!entry.name.endsWith(".test.ts")
		) {
			const stats = await stat(full);
			max = Math.max(max, stats.mtimeMs);
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
