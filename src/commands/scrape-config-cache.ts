/** @file Cache sub-action for /scrape-config. */
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { resolvePiStoragePaths } from "../storage/paths.ts";
import { toolResult } from "../tools/infra/result.ts";
import type { CommandContext } from "./define.ts";
import type { Params } from "./scrape-config.ts";

export async function runScrapeConfigCache(params: Params, ctx?: CommandContext) {
	const op = params.op ?? "stats";
	if (op === "stats") {
		return await showCacheStats();
	}
	// clear
	if (ctx?.ui?.confirm) {
		const confirmed = await ctx.ui.confirm(
			"Clear cache",
			"Delete all cached scrape responses? This cannot be undone.",
			{ signal: ctx.signal },
		);
		if (!confirmed) {
			return toolResult({
				text: "Cache clear cancelled.",
				data: { cleared: false },
			});
		}
	} else if (!params.force) {
		return toolResult({
			text: "Headless invocation requires explicit --force to clear cache.",
			data: { error: "needs_force" },
		});
	}
	const { count, bytes } = await clearResultsDir();
	return toolResult({
		text: `Cleared ${count} response entries (${formatBytes(bytes)} freed).`,
		data: { cleared: true, count, bytes },
	});
}

async function showCacheStats() {
	const results = await dirStats(resolvePiStoragePaths().results);
	const snapshots = await dirStats(resolvePiStoragePaths().snapshots);
	return toolResult({
		text: `Results: ${results.count} entries · ${formatBytes(results.bytes)}\nSnapshots: ${snapshots.count} entries · ${formatBytes(snapshots.bytes)}`,
		data: { results, snapshots },
	});
}

async function dirStats(dir: string): Promise<{ count: number; bytes: number }> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		let count = 0;
		let bytes = 0;
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			count++;
			try {
				const s = await stat(path.join(dir, entry.name));
				bytes += s.size;
			} catch {
				// ignore unreadable files
			}
		}
		return { count, bytes };
	} catch {
		return { count: 0, bytes: 0 };
	}
}

async function clearResultsDir(): Promise<{ count: number; bytes: number }> {
	const dir = resolvePiStoragePaths().results;
	let count = 0;
	let bytes = 0;
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const filePath = path.join(dir, entry.name);
			try {
				const s = await stat(filePath);
				bytes += s.size;
				await unlink(filePath);
				count++;
			} catch {
				// ignore errors
			}
		}
	} catch {
		// ignore
	}
	return { count, bytes };
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
