/**
 * @fileoverview storage jobs module.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OutputFormat, ScrapeMode, StructuredError } from "../types.js";
import {
	ensureDir,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "./paths.js";

export type JobType = "crawl" | "batch" | "diff" | "snapshot";
export type JobStatus = "queued" | "running" | "paused" | "done" | "error";

export interface JobError {
	url?: string;
	phase: string;
	code: string;
	message: string;
}

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

const SECRET_KEY_PATTERN =
	/(authorization|cookie|cookies|token|api[-_]?key|password|passwd|secret|proxy|headers)/iu;

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

export function sanitizeJobParams(value: unknown): Record<string, unknown> {
	const sanitized = sanitizeValue(value, 0);
	return isRecord(sanitized) ? sanitized : {};
}

export function structuredErrorToJobError(error: StructuredError): JobError {
	return {
		url: error.url ?? error.finalUrl,
		phase: error.phase,
		code: error.code,
		message: error.message,
	};
}

export function unknownToJobError(
	error: unknown,
	phase: string,
	url?: string,
): JobError {
	if (isRecord(error) && "structured" in error) {
		return structuredErrorToJobError(error.structured as StructuredError);
	}
	return {
		url,
		phase,
		code: error instanceof Error ? error.name : "JOB_ERROR",
		message: error instanceof Error ? error.message : "Job failed",
	};
}

export function appendJobError(
	errors: readonly JobError[],
	error: JobError,
): JobError[] {
	return [...errors, error].slice(-50);
}

function sanitizeValue(value: unknown, depth: number): unknown {
	if (depth > 4) return "[truncated]";
	if (value === null || value === undefined) return value;
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	)
		return value;
	if (Array.isArray(value))
		return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
	if (!isRecord(value)) return undefined;
	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (SECRET_KEY_PATTERN.test(key)) continue;
		if (typeof entry === "function" || typeof entry === "symbol") continue;
		output[key] = sanitizeValue(entry, depth + 1);
	}
	return output;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
