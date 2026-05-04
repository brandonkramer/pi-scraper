#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { intFlag } from "../../lib/cli-args.mjs";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const args = process.argv.slice(2);
const timeoutSeconds = intFlag(args, "timeoutSeconds", 30);
const outDir = path.join(rootDir, "bench/fixtures");
const urls = [
	["dogster-home", "https://www.dogster.com/"],
	["github-repo", "https://github.com/brandonkramer/pi-scraper"],
	["npmx-package", "https://npmx.dev/package/pi-scraper"],
	["docs-site", "https://docs.astro.build/en/getting-started/"],
	["article-page", "https://example.com/"],
	["marketing-page", "https://www.cloudflare.com/"],
	["spa-json-hydration", "https://quotes.toscrape.com/js/"],
];

await mkdir(outDir, { recursive: true });
const manifest = [];
for (const [id, url] of urls) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1_000);
	try {
		const response = await fetch(url, {
			redirect: "follow",
			signal: controller.signal,
			headers: { "user-agent": "pi-scraper-benchmark/0.0" },
		});
		const text = await response.text();
		const filename = `${id}.html`;
		await writeFile(path.join(outDir, filename), text);
		manifest.push({
			id,
			url,
			finalUrl: response.url,
			status: response.status,
			filename,
			bytes: Buffer.byteLength(text),
		});
	} catch (error) {
		manifest.push({
			id,
			url,
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		clearTimeout(timeout);
	}
}
await writeFile(
	path.join(outDir, "manifest.json"),
	`${JSON.stringify({ generatedAt: new Date().toISOString(), urls: manifest }, null, 2)}\n`,
);
console.log(
	`Wrote ${manifest.filter((item) => item.filename).length}/${manifest.length} snapshots to ${path.relative(rootDir, outDir)}`,
);
console.log(
	`Run: npm run compare:dom -- --fixture-dir=${path.relative(rootDir, outDir)}`,
);
