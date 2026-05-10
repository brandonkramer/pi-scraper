/**
 * @fileoverview diff snapshots module.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScrapeResult } from "../scrape/pipeline.ts";
import { openStorageDb } from "../storage/db/open.ts";
import {
	ensureDir,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "../storage/paths.ts";
import { readResponse } from "../storage/responses/read.ts";
import type { ResponseStorageMetadata, StructuredError } from "../types.ts";
import { normalizeUrl } from "../url/normalize.ts";
import { compareSnapshotText, type TextDiffSummary } from "./compare.ts";
import {
	type NormalizedSnapshotContent,
	normalizeScrapeForSnapshot,
	type SnapshotLink,
} from "./normalize.ts";

export interface SnapshotOptions extends ResolveStorageOptions {
	snapshotName?: string;
	snapshotTag?: string;
	compareTag?: string;
}

export interface PageSnapshotMetadata {
	url: string;
	finalUrl?: string;
	timestamp: string;
	mode?: string;
	format?: string;
	statusCode?: number;
	contentType?: string;
	contentLength?: number;
	contentHash: string;
	normalizedHash: string;
	snapshotName?: string;
	snapshotTag?: string;
	responseId?: string;
	fullOutputPath?: string;
}

export interface PageSnapshot {
	url: string;
	finalUrl?: string;
	timestamp: string;
	textHash: string;
	contentHash: string;
	normalizedHash: string;
	snapshotName?: string;
	snapshotTag?: string;
	metadata: PageSnapshotMetadata;
	content: NormalizedSnapshotContent;
}

export interface SnapshotChangeSummary {
	addedHeadings: string[];
	removedHeadings: string[];
	addedLinks: SnapshotLink[];
	removedLinks: SnapshotLink[];
	changedMetadata: Array<{ key: string; previous?: string; current?: string }>;
	paragraphs: TextDiffSummary;
	unchangedAfterNormalization: boolean;
	hashOnlyChange: boolean;
}

export interface SnapshotDiffResult {
	previous?: PageSnapshot;
	current: PageSnapshot;
	diff?: TextDiffSummary;
	summary?: SnapshotChangeSummary;
	snapshotPath: string;
	snapshotName?: string;
	snapshotTag?: string;
	compareTag?: string;
}

export interface SnapshotListingEntry {
	snapshotPath: string;
	metadata: PageSnapshotMetadata;
}

export async function saveSnapshot(
	result: ScrapeResult,
	options: SnapshotOptions = {},
): Promise<{ snapshot: PageSnapshot; path: string }> {
	const snapshot = snapshotFromResult(result, options);
	const filePath = await snapshotPath(snapshot.url, options);
	await writeFile(filePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
	return { snapshot, path: filePath };
}

export async function loadSnapshot(
	url: string,
	options: SnapshotOptions = {},
): Promise<PageSnapshot | undefined> {
	if (options.snapshotTag) {
		const indexed = await loadIndexedSnapshot(url, options);
		if (indexed) return indexed;
		return loadFileSnapshot(url, options);
	}
	const indexed = await loadIndexedSnapshot(url, options);
	if (indexed) return indexed;
	return loadFileSnapshot(url, options);
}

export async function listSnapshots(
	options: SnapshotOptions & { url?: string } = {},
): Promise<SnapshotListingEntry[]> {
	const dir = await ensureDir(resolvePiStoragePaths(options).snapshots);
	const files = await readdir(dir);
	const entries: SnapshotListingEntry[] = [];
	for (const file of files.filter((entry) => entry.endsWith(".json"))) {
		const snapshotPath = path.join(dir, file);
		try {
			const snapshot = normalizeLoadedSnapshot(
				JSON.parse(await readFile(snapshotPath, "utf8")) as PageSnapshot,
			);
			if (
				options.url &&
				normalizeUrl(snapshot.url) !== normalizeUrl(options.url)
			)
				continue;
			if (
				options.snapshotName &&
				(!snapshot.snapshotName ||
					safeSnapshotName(snapshot.snapshotName) !==
						safeSnapshotName(options.snapshotName))
			)
				continue;
			if (
				options.snapshotTag &&
				(!snapshot.snapshotTag ||
					safeSnapshotName(snapshot.snapshotTag) !==
						safeSnapshotName(options.snapshotTag))
			)
				continue;
			entries.push({ snapshotPath, metadata: snapshot.metadata });
		} catch {
			/* Ignore corrupt/partial snapshot files during listing. */
		}
	}
	return entries.sort((left, right) =>
		right.metadata.timestamp.localeCompare(left.metadata.timestamp),
	);
}

export async function diffScrapeResult(
	result: ScrapeResult,
	options: SnapshotOptions = {},
): Promise<SnapshotDiffResult> {
	const url = result.url ?? "";
	const baselineOptions = options.compareTag
		? { ...options, snapshotTag: options.compareTag, compareTag: undefined }
		: { ...options, snapshotTag: undefined, compareTag: undefined };
	const previous = await loadSnapshot(url, baselineOptions);
	if (options.compareTag && !previous)
		throw missingSnapshotTagError(url, options);
	const saved = await saveSnapshot(result, options);
	const diff = previous
		? compareSnapshotText(previous.content.text, saved.snapshot.content.text)
		: undefined;
	const summary = previous
		? summarizeSnapshotChanges(previous, saved.snapshot, diff)
		: undefined;
	return {
		previous,
		current: saved.snapshot,
		diff,
		summary,
		snapshotPath: saved.path,
		snapshotName: options.snapshotName,
		snapshotTag: options.snapshotTag,
		compareTag: options.compareTag,
	};
}

export function snapshotFromResult(
	result: ScrapeResult,
	options: SnapshotOptions = {},
): PageSnapshot {
	const content = normalizeScrapeForSnapshot(result);
	const timestamp = new Date().toISOString();
	const contentHash = hash(content.rawText);
	const normalizedHash = hash(content.text);
	const metadata: PageSnapshotMetadata = {
		url: content.url,
		finalUrl: content.finalUrl,
		timestamp,
		mode: result.mode,
		format: result.format,
		statusCode: result.status,
		contentType: result.contentType,
		contentLength: result.downloadedBytes ?? Buffer.byteLength(content.rawText),
		contentHash,
		normalizedHash,
		snapshotName: options.snapshotName,
		snapshotTag: options.snapshotTag,
		responseId: result.responseId,
		fullOutputPath: result.fullOutputPath,
	};
	return {
		url: content.url,
		finalUrl: content.finalUrl,
		timestamp,
		textHash: normalizedHash,
		contentHash,
		normalizedHash,
		snapshotName: options.snapshotName,
		snapshotTag: options.snapshotTag,
		metadata,
		content,
	};
}

export function summarizeSnapshotChanges(
	previous: PageSnapshot,
	current: PageSnapshot,
	diff = compareSnapshotText(previous.content.text, current.content.text),
): SnapshotChangeSummary {
	const paragraphs = compareSnapshotText(
		previous.content.paragraphs.join("\n"),
		current.content.paragraphs.join("\n"),
	);
	const changedMetadata = compareMetadata(
		previous.content.metadata,
		current.content.metadata,
	);
	const unchangedAfterNormalization =
		previous.contentHash !== current.contentHash &&
		previous.normalizedHash === current.normalizedHash;
	return {
		addedHeadings: missingFrom(
			current.content.headings,
			previous.content.headings,
		),
		removedHeadings: missingFrom(
			previous.content.headings,
			current.content.headings,
		),
		addedLinks: missingLinks(current.content.links, previous.content.links),
		removedLinks: missingLinks(previous.content.links, current.content.links),
		changedMetadata,
		paragraphs,
		unchangedAfterNormalization,
		hashOnlyChange:
			previous.contentHash !== current.contentHash &&
			diff.addedCount === 0 &&
			diff.removedCount === 0 &&
			diff.changedCount === 0,
	};
}

export async function updateSnapshotReference(
	url: string,
	response: ResponseStorageMetadata,
	options: SnapshotOptions = {},
): Promise<{ snapshot: PageSnapshot; path: string } | undefined> {
	const snapshot = await loadFileSnapshot(url, options);
	if (!snapshot) return undefined;
	const updated = attachSnapshotResponse(snapshot, response);
	const filePath = await snapshotPath(url, options);
	await writeFile(filePath, JSON.stringify(updated, null, 2), { mode: 0o600 });
	await upsertSnapshotRow(url, updated, response, options);
	return { snapshot: updated, path: filePath };
}

async function loadFileSnapshot(
	url: string,
	options: SnapshotOptions,
): Promise<PageSnapshot | undefined> {
	return readSnapshotFile(await snapshotPath(url, options));
}

async function readSnapshotFile(
	filePath: string,
): Promise<PageSnapshot | undefined> {
	try {
		return normalizeLoadedSnapshot(
			JSON.parse(await readFile(filePath, "utf8")) as PageSnapshot,
		);
	} catch {
		return undefined;
	}
}

async function loadIndexedSnapshot(
	url: string,
	options: SnapshotOptions,
): Promise<PageSnapshot | undefined> {
	try {
		const db = await openStorageDb(options);
		const row = db
			.prepare(SELECT_SNAPSHOT)
			.get(normalizeUrl(url), snapshotStorageKey(options)) as
			| { response_id: string }
			| undefined;
		if (!row) return undefined;
		const stored = await readResponse<SnapshotDiffResult>(
			row.response_id,
			options,
		);
		return normalizeLoadedSnapshot(stored.value.current);
	} catch {
		return undefined;
	}
}

async function upsertSnapshotRow(
	url: string,
	snapshot: PageSnapshot,
	response: ResponseStorageMetadata,
	options: SnapshotOptions,
): Promise<void> {
	const db = await openStorageDb(options);
	db.prepare(UPSERT_SNAPSHOT).run(
		normalizeUrl(url),
		snapshotStorageKey(options),
		response.responseId,
		snapshot.timestamp,
	);
}

export function attachSnapshotResponse(
	snapshot: PageSnapshot,
	response: ResponseStorageMetadata,
): PageSnapshot {
	return {
		...snapshot,
		metadata: {
			...snapshot.metadata,
			responseId: response.responseId,
			fullOutputPath: response.fullOutputPath,
		},
	};
}

async function snapshotPath(
	url: string,
	options: SnapshotOptions,
): Promise<string> {
	const dir = await ensureDir(resolvePiStoragePaths(options).snapshots);
	const name = options.snapshotName
		? `--${safeSnapshotName(options.snapshotName)}`
		: "";
	const tag = options.snapshotTag
		? `--tag-${safeSnapshotName(options.snapshotTag)}`
		: "";
	return path.join(dir, `${hash(normalizeUrl(url))}${name}${tag}.json`);
}

function normalizeLoadedSnapshot(snapshot: PageSnapshot): PageSnapshot {
	const content = normalizeLoadedContent(snapshot.content);
	const normalizedHash = snapshot.normalizedHash ?? snapshot.textHash;
	const contentHash = snapshot.contentHash ?? hash(content.rawText);
	const metadata = snapshot.metadata ?? {
		url: snapshot.url,
		finalUrl: snapshot.finalUrl,
		timestamp: snapshot.timestamp,
		contentHash,
		normalizedHash,
		snapshotName: snapshot.snapshotName,
		snapshotTag: snapshot.snapshotTag,
	};
	return {
		...snapshot,
		content,
		contentHash,
		normalizedHash,
		textHash: normalizedHash,
		snapshotName: metadata.snapshotName ?? snapshot.snapshotName,
		snapshotTag: metadata.snapshotTag ?? snapshot.snapshotTag,
		metadata: {
			...metadata,
			snapshotName: metadata.snapshotName ?? snapshot.snapshotName,
			snapshotTag: metadata.snapshotTag ?? snapshot.snapshotTag,
		},
	};
}

function normalizeLoadedContent(
	content: NormalizedSnapshotContent,
): NormalizedSnapshotContent {
	const rawText = content.rawText ?? content.text;
	return {
		...content,
		rawText,
		headings: content.headings ?? [],
		links: content.links ?? [],
		metadata: content.metadata ?? {},
		paragraphs:
			content.paragraphs ??
			rawText
				.split("\n")
				.filter((line) => line.length >= 24)
				.slice(0, 100),
	};
}

function compareMetadata(
	previous: Record<string, string>,
	current: Record<string, string>,
): SnapshotChangeSummary["changedMetadata"] {
	const keys = [
		...new Set([...Object.keys(previous), ...Object.keys(current)]),
	].sort();
	return keys
		.filter((key) => previous[key] !== current[key])
		.map((key) => ({ key, previous: previous[key], current: current[key] }))
		.slice(0, 50);
}

function missingFrom(left: string[], right: string[]): string[] {
	const rightSet = new Set(right.map((value) => value.toLowerCase()));
	return left
		.filter((value) => !rightSet.has(value.toLowerCase()))
		.slice(0, 25);
}

function missingLinks(
	left: SnapshotLink[],
	right: SnapshotLink[],
): SnapshotLink[] {
	const rightSet = new Set(right.map((link) => link.url));
	return left.filter((link) => !rightSet.has(link.url)).slice(0, 25);
}

function snapshotStorageKey(options: SnapshotOptions): string {
	if (!options.snapshotTag) return options.snapshotName ?? "";
	return `${options.snapshotName ?? ""}#tag:${safeSnapshotName(options.snapshotTag)}`;
}

function missingSnapshotTagError(
	url: string,
	options: SnapshotOptions,
): Error & { structured: StructuredError } {
	const tag = options.compareTag ?? options.snapshotTag ?? "";
	const message = `No snapshot tag '${tag}' exists for ${url}. Use web_get_result with snapshotUrl to list available tags.`;
	return Object.assign(new Error(message), {
		structured: {
			code: "SNAPSHOT_TAG_NOT_FOUND",
			phase: "diff",
			message,
			retryable: false,
			url,
		},
	});
}

function safeSnapshotName(input: string): string {
	const safe = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 80);
	if (!safe)
		throw new Error("snapshotName must contain at least one letter or number");
	return safe;
}

function hash(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

const SELECT_SNAPSHOT = `SELECT response_id FROM snapshots
WHERE url = ? AND snapshot_name = ? ORDER BY taken_at DESC LIMIT 1`;

const UPSERT_SNAPSHOT = `INSERT OR REPLACE INTO snapshots
(url, snapshot_name, response_id, taken_at) VALUES (?, ?, ?, ?)`;
