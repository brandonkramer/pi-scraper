/**
 * @fileoverview Storage helpers for compiled context artifacts.
 *
 * context are stored through the normal response blob path for
 * responseId retrieval. Crawl-scoped copies live under the configured Pi crawl
 * directory so humans can inspect them beside crawl state without bypassing the
 * central storage path resolver.
 */
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CompiledContext } from "../../extract/context.ts";
import {
	ensureDir,
	resolvePiStoragePaths,
	type ResolveStorageOptions,
} from "../paths.ts";

export interface StoredContextFile {
	path: string;
}

export async function writeCrawlContextFile(
	crawlId: string,
	contextPackage: CompiledContext,
	options: ResolveStorageOptions = {},
): Promise<StoredContextFile> {
	const dir = await ensureDir(
		path.join(resolvePiStoragePaths(options).crawl, safeSegment(crawlId)),
	);
	const filePath = path.join(dir, "package.json");
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(contextPackage, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(tempPath, filePath);
	return { path: filePath };
}

function safeSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 160) || "crawl";
}
