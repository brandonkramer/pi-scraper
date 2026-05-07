#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const expectedTools = [
	"web_scrape",
	"web_crawl",
	"web_map",
	"web_batch",
	"web_diff",
	"web_extract",
];

const tempDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-install-"));
let tarball;
try {
	const pack = JSON.parse(exec("npm", ["pack", "--json"], rootDir))[0];
	tarball = path.join(rootDir, pack.filename);
	exec("npm", ["init", "-y"], tempDir);
	exec(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			tarball,
			"@mariozechner/pi-ai@latest",
			"@sinclair/typebox@latest",
		],
		tempDir,
	);
	await writeSmokeTest(tempDir);
	const vitestBin = path.join(rootDir, "node_modules/.bin/vitest");
	exec(
		vitestBin,
		["run", "install-smoke.test.ts", "--reporter=verbose"],
		tempDir,
	);
	console.log(
		`install smoke passed for ${pack.name}@${pack.version}: ${expectedTools.length} tools registered`,
	);
} finally {
	await rm(tempDir, { recursive: true, force: true });
	if (tarball) await rm(tarball, { force: true });
}

function exec(command, args, cwd) {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});
}

async function writeSmokeTest(dir) {
	const pkg = JSON.parse(
		await readFile(
			path.join(dir, "node_modules/pi-scraper/package.json"),
			"utf8",
		),
	);
	if (pkg.pi?.extensions?.[0] !== "./src/index.ts")
		throw new Error("pi extension manifest is missing ./src/index.ts");
	const source = `
import { describe, expect, it } from "vitest";
import register from "./node_modules/pi-scraper/src/index.ts";

const expectedTools = ${JSON.stringify(expectedTools)};

describe("packed pi-scraper extension", () => {
	it("registers all public web tools from the installed tarball", () => {
		const tools = [];
		const commands = [];
		const events = [];
		register({
			registerTool: (tool) => tools.push(tool.name),
			registerCommand: (name, _definition) => commands.push(name),
			on: (event) => events.push(event),
		});
		expect(tools.sort()).toEqual([...expectedTools].sort());
		expect(commands).toEqual(["web-set-mode"]);
		expect(events).toContain("session_start");
	});
});
`;
	await writeFile(path.join(dir, "install-smoke.test.ts"), source);
}
