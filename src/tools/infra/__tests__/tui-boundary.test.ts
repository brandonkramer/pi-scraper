/** @file Guard that tool renderers use the named TUI component surface only. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const toolsRoot = fileURLToPath(new URL("../..", import.meta.url));
const allowedIndexImports = new Set(["toolCall", "RenderComponent", "RenderTheme"]);

describe("tool TUI import boundary", () => {
	it("imports only approved public index names from tools", () => {
		const offenders = sourceFiles(toolsRoot).flatMap((file) => forbiddenIndexImports(file));
		expect(offenders).toEqual([]);
	});
});

function forbiddenIndexImports(file: string): string[] {
	const text = readFileSync(file, "utf8");
	const offenders: string[] = [];
	const importPattern = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'][^"']*tui\/index\.ts["']/gu;
	for (const match of text.matchAll(importPattern)) {
		const names = match[1]?.split(",") ?? [];
		for (const rawName of names) {
			const name = rawName
				.trim()
				.replace(/^type\s+/u, "")
				.split(/\s+as\s+/u)[0]
				?.trim();
			if (name && !allowedIndexImports.has(name))
				offenders.push(`${relative(toolsRoot, file)}:${name}`);
		}
	}
	return offenders;
}

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			files.push(...sourceFiles(path));
			continue;
		}
		if (/\.tsx?$/u.test(entry)) files.push(path);
	}
	return files;
}
