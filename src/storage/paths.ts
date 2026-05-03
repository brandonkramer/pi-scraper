import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface PiStoragePaths {
	root: string;
	config: string;
	results: string;
	crawl: string;
	snapshots: string;
}

export interface ResolveStorageOptions {
	rootDir?: string;
}

export function expandHome(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
	return input;
}

export function resolvePiStoragePaths(
	options: ResolveStorageOptions = {},
): PiStoragePaths {
	const root = path.resolve(expandHome(options.rootDir ?? "~/.pi"));
	return {
		root,
		config: path.join(root, "config"),
		results: path.join(root, "results"),
		crawl: path.join(root, "crawl"),
		snapshots: path.join(root, "snapshots"),
	};
}

export async function ensureDir(dir: string): Promise<string> {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	return dir;
}

export async function ensurePiStoragePaths(
	options: ResolveStorageOptions = {},
): Promise<PiStoragePaths> {
	const paths = resolvePiStoragePaths(options);
	await Promise.all(Object.values(paths).map((dir) => ensureDir(dir)));
	return paths;
}
