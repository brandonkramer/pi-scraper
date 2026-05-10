/**
 * @fileoverview Job manifest types and file-system CRUD.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	OutputFormat,
	ScrapeMode,
} from "../../types.ts";
import {
	ensureDir,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "../paths.ts";
import { sanitizeJobParams } from "./sanitize.ts";
import type { JobError } from "./errors.ts";

export type JobType = "crawl" | "batch" | "diff" | "snapshot";
export type JobStatus = "queued" | "running" | "paused" | "done" | "error";

export interface JobManifest {
	jobId: string;
	jobType: JobType;
	status: JobStatus;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	params: Record<string, unknown>;
	urlsProcessed: number;
	urlsFailed: number;
	errors: JobError[];
	mode: ScrapeMode | string;
	format?: OutputFormat | string;
	totalBytes?: number;
	totalChars?: number;
	truncatedPages?: number;
	responseIds?: string[];
	snapshots?: {
		previous?: unknown;
		current?: unknown;
		path?: string;
		snapshotName?: string;
		snapshotTag?: string;
		compareTag?: string;
	};
}

export type JobManifestPatch = Partial<
	Omit<JobManifest, "jobId" | "jobType" | "createdAt">
>;

export async function writeJobManifest(
	manifest: JobManifest,
	options: ResolveStorageOptions = {},
): Promise<string> {
	const filePath = await jobManifestPath(manifest.jobId, options);
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
		.toString(36)
		.slice(2)}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(tempPath, filePath);
	return filePath;
}

export async function updateJobManifest(
	jobId: string,
	patch: JobManifestPatch,
	options: ResolveStorageOptions = {},
): Promise<{ manifest: JobManifest; path: string }> {
	const existing = await getJobManifest(jobId, options);
	const manifest: JobManifest = {
		...existing.manifest,
		...patch,
		params: patch.params ?? existing.manifest.params,
		errors: patch.errors ?? existing.manifest.errors,
		responseIds: mergeUnique(existing.manifest.responseIds, patch.responseIds),
		snapshots: patch.snapshots ?? existing.manifest.snapshots,
	};
	const filePath = await writeJobManifest(manifest, options);
	return { manifest, path: filePath };
}

export async function getJobManifest(
	jobId: string,
	options: ResolveStorageOptions = {},
): Promise<{ manifest: JobManifest; path: string }> {
	const filePath = await jobManifestPath(jobId, options);
	const manifest = JSON.parse(await readFile(filePath, "utf8")) as JobManifest;
	return { manifest, path: filePath };
}

export async function jobManifestPath(
	jobId: string,
	options: ResolveStorageOptions = {},
): Promise<string> {
	const dir = await ensureDir(resolvePiStoragePaths(options).jobs);
	return path.join(dir, `${safeJobId(jobId)}.json`);
}

export function createJobManifest(input: {
	jobId: string;
	jobType: JobType;
	status?: JobStatus;
	createdAt?: string;
	startedAt?: string;
	params?: unknown;
	mode?: ScrapeMode | string;
	format?: OutputFormat | string;
}): JobManifest {
	const now = new Date().toISOString();
	return {
		jobId: input.jobId,
		jobType: input.jobType,
		status: input.status ?? "queued",
		createdAt: input.createdAt ?? now,
		startedAt: input.startedAt,
		params: sanitizeJobParams(input.params),
		urlsProcessed: 0,
		urlsFailed: 0,
		errors: [],
		mode: input.mode ?? "auto",
		format: input.format,
	};
}

function safeJobId(jobId: string): string {
	return jobId.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 160) || "job";
}

function mergeUnique(
	left: string[] | undefined,
	right: string[] | undefined,
): string[] | undefined {
	const merged = [...(left ?? []), ...(right ?? [])].filter(Boolean);
	return merged.length ? [...new Set(merged)] : undefined;
}
