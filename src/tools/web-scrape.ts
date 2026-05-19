/** @file Pi tool adapter for single-URL scraping, snapshot writing, and diffing. */
import { Type, type Static } from "typebox";

import {
	diffScrapeResult,
	saveSnapshot,
	type SnapshotDiffResult,
	updateSnapshotReference,
} from "../diff/snapshots.ts";
import type { ModelAdapter } from "../extract/adhoc/model.ts";
import { saveBodyToDownloads } from "../http/download-storage.ts";
import { getOrCreateSession } from "../http/session.ts";
import { describeScrapeResult, formatAge } from "../scrape/describe.ts";
import { filterLines } from "../scrape/line-filter.ts";
import { formatLineMatchPreview } from "../scrape/line-preview.ts";
import { resolveScrapeOptions } from "../scrape/options.ts";
import type { ScrapePipelineDeps, ScrapeResult } from "../scrape/pipeline.ts";
import { freshnessFromTimestamp } from "../storage/cache/freshness.ts";
import { storeResponseWithId } from "../storage/responses/store.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { qualityFromCache, refreshUrlAction, storedTraceContext } from "./infra/agentic-context.ts";
import { defineWebTool, type WebTool } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import {
	inputErrorResult,
	missingModelResult,
	toolErrorResult,
	toolResult,
} from "./infra/result.ts";
import { sessionOptionSchema, urlProperty } from "./infra/schemas.ts";
import { buildSummarizeToolResult } from "./infra/scrape-input-result.ts";
import { sessionLifecycle } from "./infra/session-lifecycle.ts";
import { renderWebDiffResult } from "./renderers/diff.ts";
import { renderWebScrapeResult } from "./renderers/scrape.ts";

const scrapeTasks = ["read", "summarize"] as const;

export const webScrapeSchema = Type.Object({
	task: Type.Optional(Type.Any()),
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.Any()),
	sentences: Type.Optional(Type.Any()),
	bullets: Type.Optional(Type.Any()),
	mode: Type.Optional(Type.Any()),
	format: Type.Optional(Type.Any()),
	include: Type.Optional(Type.Array(Type.Any())),
	exclude: Type.Optional(Type.Array(Type.Any())),
	onlyMainContent: Type.Optional(Type.Any()),
	timeoutSeconds: Type.Optional(Type.Any()),
	maxChars: Type.Optional(Type.Any()),
	proxy: Type.Optional(Type.Any()),
	respectRobots: Type.Optional(Type.Any()),
	refresh: Type.Optional(Type.Any()),
	followAlternates: Type.Optional(Type.Unsafe<boolean>({})),
	followMetaRefresh: Type.Optional(Type.Unsafe<boolean>({})),
	saveToFile: Type.Optional(
		Type.Unsafe<boolean | { dir?: string; filename?: string; maxBytes?: number }>({
			description: "true or {dir,filename,maxBytes} — download to content-addressed disk storage",
		}),
	),
	snapshotName: Type.Optional(Type.String({ description: "Name." })),
	snapshotTag: Type.Optional(Type.String({ description: "Tag." })),
	diff: Type.Optional(
		Type.Unsafe<
			| boolean
			| {
					snapshotName?: string;
					snapshotTag?: string;
					compareTag?: string;
					maxSnapshotAgeSeconds?: number;
			  }
		>({
			description: "true or {snapshotName,snapshotTag,compareTag,maxSnapshotAgeSeconds}",
		}),
	),
	linesMatching: Type.Optional(Type.Array(Type.Unsafe<string>({}))),
	contextLines: Type.Optional(Type.Unsafe<number>({})),
	caseSensitive: Type.Optional(Type.Unsafe<boolean>({})),

	...sessionOptionSchema,
	stealth: Type.Optional(Type.Any()),
	autoWait: Type.Optional(Type.Any()),
});

type Params = Static<typeof webScrapeSchema>;
type DiffParams = Exclude<Params["diff"], boolean | undefined>;
type ScrapeTask = (typeof scrapeTasks)[number];

export interface WebScrapeToolOptions {
	modelAdapter?: ModelAdapter;
	scrapeDeps?: ScrapePipelineDeps;
}

export function createWebScrapeTool(
	options: WebScrapeToolOptions = {},
): WebTool<typeof webScrapeSchema> {
	return defineWebTool({
		name: "web_scrape",
		label: "Scrape",
		description: "Read URL (snapshotName/diff)",
		parameters: webScrapeSchema,
		async execute(_toolCallId, params: Params, signal, onUpdate) {
			const task = inferScrapeTask(params);
			if (task === "summarize") return await summarizeScrape(params, options, signal);
			if (params.diff !== undefined) return await diffScrape(params, signal, onUpdate);
			return await readScrape(params, signal, onUpdate);
		},
		renderCall: (args, theme, _context) =>
			renderSimpleCall("web_scrape", renderScrapeCallParts(args), theme),
		renderResult: (result, { expanded }, theme) => {
			const details = result.details as Partial<{ kind: string }>;
			if (details.kind === "diff") return renderWebDiffResult(result, expanded, theme);
			return renderWebScrapeResult(result, expanded, theme);
		},
	});
}

export const webScrapeTool = createWebScrapeTool();

function inferScrapeTask(params: Params): ScrapeTask {
	if (params.task) return params.task as ScrapeTask;
	if (params.content && !params.url) return "summarize";
	return "read";
}

function renderScrapeCallParts(params: Params): string[] {
	const task = inferScrapeTask(params);
	if (task === "summarize") {
		return [
			"summarize",
			params.url ?? "provided content",
			params.bullets
				? `${String(params.bullets)} bullets`
				: params.sentences
					? `${String(params.sentences)} sentences`
					: undefined,
		].filter(Boolean) as string[];
	}
	return [`(${String(params.mode ?? "auto")} → ${String(params.format ?? "markdown")})`];
}

async function readScrape(
	params: Params,
	signal: AbortSignal,
	onUpdate?: Parameters<WebTool<typeof webScrapeSchema>["execute"]>[3],
) {
	if (!params.url) {
		return inputErrorResult(
			"SCRAPE_URL_MISSING",
			"scrape",
			"web_scrape task=read requires url.",
			"Provide url for web_scrape task=read.",
		);
	}
	const { loadEffectiveConfig } = await import("../config.ts");
	const config = await loadEffectiveConfig();
	const session = params.sessionId ? await getOrCreateSession(params.sessionId) : undefined;
	if (session) {
		const extra = params as Record<string, unknown>;
		if (extra.browserProfile) session.defaultBrowserProfile = extra.browserProfile as string;
		if (params.proxy) session.defaultProxy = params.proxy;
		if (params.mode) session.defaultMode = params.mode;
		if (extra.headers)
			session.defaultHeaders = {
				...session.defaultHeaders,
				...(extra.headers as Record<string, string>),
			};
	}
	const scrapeOptions = resolveScrapeOptions(params, config, session);
	await emitProgress(onUpdate, {
		state: "loading",
		url: params.url,
		message: `scraping ${scrapeOptions.mode}`,
		checklist: [
			{ id: "validated", label: "URL validated", state: "done" },
			{ id: "robots", label: "robots checked", state: "pending" },
			{ id: "fetch", label: "fetching page", state: "pending" },
			{ id: "parse", label: "parsing content", state: "pending" },
			{ id: "store", label: "storing result", state: "pending" },
		],
	});
	const { scrapeUrl } = await import("../scrape/pipeline.ts");
	let result = await scrapeUrl(params.url, scrapeOptions, {}, signal);
	const needles = params.linesMatching;
	if (needles && needles.length > 0 && !result.error) {
		const text = result.data.rawText ?? result.data.text ?? "";
		const matches = filterLines(text, needles, params.contextLines, params.caseSensitive);
		result = { ...result, data: { ...result.data, matches } };
	}
	await emitProgress(onUpdate, {
		state: result.error ? "error" : "done",
		url: result.finalUrl ?? params.url,
		message: result.error?.message,
		checklist: [
			{ id: "validated", label: "URL validated", state: "done" },
			{ id: "robots", label: "robots checked", state: "done" },
			{
				id: "fetch",
				label: result.cache?.cached ? "cache hit" : "fetched page",
				state: result.error ? "failed" : "done",
			},
			{
				id: "parse",
				label: "parsed content",
				state: result.error ? "failed" : "done",
			},
			{ id: "store", label: "storing result", state: "pending" },
		],
	});
	const { storeResponse } = await import("../storage/responses/store.ts");
	const stored = await storeResponse(result);

	let snapshotSaved: { name: string; tag?: string; path: string } | undefined;

	if (params.snapshotName && !result.error && result.url) {
		try {
			const snapOptions = { snapshotName: params.snapshotName, snapshotTag: params.snapshotTag };
			const saved = await saveSnapshot(result, snapOptions);
			snapshotSaved = {
				name: params.snapshotName,
				tag: params.snapshotTag,
				path: saved.path,
			};
			await updateSnapshotReference(result.url, stored, snapOptions);
		} catch {
			// Soft failure — snapshot write failed but scrape succeeded; return with warning
		}
	}

	// saveToFile: move from temp to content-addressed storage
	let savedFilePath: string | undefined;
	if (params.saveToFile && !result.error && result.data.file) {
		try {
			const { createReadStream } = await import("node:fs");
			const { unlink } = await import("node:fs/promises");
			const fileInfo = result.data.file as { path: string; contentType?: string };
			const saveOpts = typeof params.saveToFile === "object" ? params.saveToFile : {};
			const stream = createReadStream(fileInfo.path);
			const sourceUrl = result.url ?? result.finalUrl ?? "https://unknown";
			const dl = await saveBodyToDownloads(
				stream,
				fileInfo.contentType,
				sourceUrl,
				result.data.file as Record<string, string>,
				saveOpts,
			);
			savedFilePath = dl.filePath;
			await unlink(fileInfo.path).catch(() => null);
			result = {
				...result,
				data: {
					...result.data,
					file: { ...result.data.file, path: dl.filePath, sha256: dl.sha256 },
				},
			};
		} catch {
			// Soft failure
		}
	}

	const matchPreview = !result.error
		? formatLineMatchPreview(result.data.matches, { maxChars: 4_000 })
		: undefined;
	const shaped = shapeScrapeResult(result, stored.responseId, matchPreview);
	const { notice: sessionNotice, suffix: sessionSuffix } = await sessionLifecycle(params);
	const description = describeScrapeResult(result);
	const scrapeText = matchPreview
		? `${description.split("\n", 1)[0]}\n${matchPreview}`
		: description;
	const snapshotSuffix = snapshotSaved
		? `\nsnapshot saved as "${snapshotSaved.name}"${snapshotSaved.tag ? ` (tag: ${snapshotSaved.tag})` : ""}`
		: "";

	return toolResult({
		text: result.error
			? `Scrape failed: ${result.error.message}`
			: `${scrapeText}\nresponseId: ${stored.responseId}${sessionSuffix}${snapshotSuffix}${savedFilePath ? `\nsaved to: ${savedFilePath}` : ""}`,
		data: result.data,
		url: result.url,
		finalUrl: result.finalUrl,
		status: result.status,
		mode: result.mode,
		format: result.format,
		timing: result.timing,
		truncated: result.truncated,
		contentType: result.contentType,
		downloadedBytes: result.downloadedBytes,
		cache: result.cache,
		responseId: stored.responseId,
		fullOutputPath: stored.fullOutputPath,
		snapshotSaved,
		savedFilePath,
		error: result.error,
		diagnostics: sessionNotice ? { sessionNotice } : undefined,
		...shaped,
	});
}

async function summarizeScrape(params: Params, options: WebScrapeToolOptions, signal: AbortSignal) {
	if (!options.modelAdapter) {
		return missingModelResult(
			"summarize",
			params.url,
			"web_scrape task=summarize requires a model-backed adapter; use task=read for source text.",
		);
	}
	try {
		const { loadEffectiveConfig } = await import("../config.ts");
		const { summarizePage } = await import("../summarize.ts");
		const config = await loadEffectiveConfig();
		const result = await summarizePage(
			{
				...config.scrapeDefaults,
				...params,
				mode: params.mode ?? config.scrapeMode,
				format: params.format ?? config.outputFormat,
			},
			options.modelAdapter,
			options.scrapeDeps ?? {},
			signal,
		);
		await sessionLifecycle(params);
		return buildSummarizeToolResult(result, params.url);
	} catch (error) {
		return toolErrorResult(error, "SUMMARIZE_FAILED", "summarize", params.url);
	}
}

async function diffScrape(
	params: Params,
	signal: AbortSignal,
	onUpdate?: Parameters<WebTool<typeof webScrapeSchema>["execute"]>[3],
) {
	if (!params.url) {
		return inputErrorResult(
			"SCRAPE_URL_MISSING",
			"scrape",
			"web_scrape diff requires url.",
			"Provide url for web_scrape diff.",
		);
	}
	const { loadEffectiveConfig } = await import("../config.ts");
	const config = await loadEffectiveConfig();
	const diffOptions = typeof params.diff === "boolean" ? {} : (params.diff as DiffParams);
	const scrapeOptions = resolveScrapeOptions(params, config);
	await emitProgress(onUpdate, {
		state: "loading",
		url: params.url,
		message:
			"snapshotName" in diffOptions && diffOptions.snapshotName
				? `diffing snapshot '${diffOptions.snapshotName}'`
				: "diffing against snapshot",
	});
	const { scrapeUrl } = await import("../scrape/pipeline.ts");
	const scrape = await scrapeUrl(params.url, scrapeOptions, {}, signal);
	if (scrape.error) {
		return toolResult({
			text: `Diff failed: ${scrape.error.message}`,
			data: {},
			url: params.url,
			kind: "diff",
			error: scrape.error,
		});
	}
	try {
		const diff = await diffScrapeResult(scrape, {
			snapshotName: "snapshotName" in diffOptions ? diffOptions.snapshotName : undefined,
			snapshotTag: "snapshotTag" in diffOptions ? diffOptions.snapshotTag : undefined,
			compareTag: "compareTag" in diffOptions ? diffOptions.compareTag : undefined,
		});
		const { metadata: stored } = await storeResponseWithId(
			(responseId) => {
				diff.current.metadata.responseId = responseId;
				return diff;
			},
			{ contentType: "application/json" },
		);
		diff.current.metadata.fullOutputPath = stored.fullOutputPath;
		await updateSnapshotReference(diff.current.url, stored, {
			snapshotName: "snapshotName" in diffOptions ? diffOptions.snapshotName : undefined,
			snapshotTag: "snapshotTag" in diffOptions ? diffOptions.snapshotTag : undefined,
		});
		const baselineFreshness = baselineFreshnessFor(
			diff,
			(diffOptions as { maxSnapshotAgeSeconds?: number }).maxSnapshotAgeSeconds,
		);
		const text = renderDiffSummary(diff, stored.responseId);
		const shaped = shapeDiffResult(diff, stored.responseId, baselineFreshness);
		return toolResult({
			text,
			data: diff,
			url: params.url,
			finalUrl: diff.current.finalUrl,
			kind: "diff",
			mode: diff.current.metadata.mode,
			format: "json",
			responseId: stored.responseId,
			fullOutputPath: stored.fullOutputPath,
			contentType: "application/json",
			freshness: baselineFreshness,
			...shaped,
		});
	} catch (error) {
		if (typeof error === "object" && error !== null && "structured" in error) {
			const err = error as {
				structured: { code: string; phase: string; message: string; retryable: boolean };
				message: string;
			};
			return toolResult({
				text: `Diff failed: ${err.message}`,
				data: {},
				url: params.url,
				kind: "diff",
				error: err.structured,
			});
		}
		throw error;
	}
}

function shapeScrapeResult(result: ScrapeResult, responseId: string, matchPreview?: string) {
	const url = result.finalUrl ?? result.url ?? "about:blank";
	const source = result.cache?.cached
		? `from cache fetched ${formatAge(result.cache.ageSeconds)} with staleness ${result.cache.staleness ?? "fresh"}`
		: "from a fresh network fetch";
	const summary = result.error
		? `Scrape failed for ${url}: ${result.error.message}`
		: `Scraped ${url} ${source}.`;
	return {
		summary,
		answerContext: result.error
			? `The scrape failed during ${result.error.phase}: ${result.error.message}`
			: `${matchPreview ?? "Page content below."}\nresponseId ${responseId} for stored access.`,
		...storedTraceContext({
			responseId,
			source: {
				id: "page",
				title: result.data.title,
				uri: url,
				excerpt: (
					matchPreview ??
					result.data.markdown ??
					result.data.text ??
					result.data.title ??
					""
				).slice(0, 240),
				relevance: "Primary scraped page content.",
				retrievedAt: result.cache?.fetchedAt ?? new Date().toISOString(),
				sourceType: "docs",
			},
			extraActions: [refreshUrlAction(url)],
		}),
		qualitySignals: qualityFromCache(result.cache),
	};
}

export function diffInterpretation(diff: SnapshotDiffResult): string {
	const name = diffLabel(diff);
	if (!diff.previous) return `No previous${name}; saved a baseline for future comparisons.`;
	if (diff.summary?.unchangedAfterNormalization)
		return `No meaningful content changes after normalization for${name}; prior content is effectively equivalent.`;
	const changed = diff.diff?.changedCount ?? 0;
	const added = diff.diff?.addedCount ?? 0;
	const removed = diff.diff?.removedCount ?? 0;
	const headingChanges =
		(diff.summary?.addedHeadings.length ?? 0) + (diff.summary?.removedHeadings.length ?? 0);
	const linkChanges =
		(diff.summary?.addedLinks.length ?? 0) + (diff.summary?.removedLinks.length ?? 0);
	if (changed === 0 && added === 0 && removed === 0 && headingChanges === 0 && linkChanges === 0) {
		return `No content changes detected for${name}; current and previous snapshots match.`;
	}
	return `Content changed for${name}: ${changed} changed, ${added} added, ${removed} removed line(s), ${headingChanges} heading change(s), ${linkChanges} link change(s).`;
}

function baselineFreshnessFor(diff: SnapshotDiffResult, maxSnapshotAgeSeconds: unknown) {
	if (!diff.previous || maxSnapshotAgeSeconds === undefined) return;
	return freshnessFromTimestamp(
		diff.previous.metadata.timestamp,
		toPositiveNumber(maxSnapshotAgeSeconds),
	);
}

function toPositiveNumber(value: unknown): number | undefined {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) && number > 0 ? number : undefined;
}

function renderDiffSummary(diff: SnapshotDiffResult, responseId: string): string {
	const name = diffLabel(diff);
	if (!diff.previous) return `No previous${name}; saved baseline. responseId: ${responseId}`;
	if (diff.summary?.unchangedAfterNormalization)
		return `Only volatile content changed after normalization for${name}. responseId: ${responseId}`;
	const textDiff = diff.diff;
	const parts = [
		textDiff
			? `${textDiff.changedCount} changed, ${textDiff.addedCount} added, ${textDiff.removedCount} removed, ${textDiff.unchanged} unchanged`
			: "No text diff",
		`${diff.summary?.addedHeadings.length ?? 0} added heading(s)`,
		`${diff.summary?.removedHeadings.length ?? 0} removed heading(s)`,
		`${diff.summary?.addedLinks.length ?? 0} added link(s)`,
		`${diff.summary?.removedLinks.length ?? 0} removed link(s)`,
		`${diff.summary?.changedMetadata.length ?? 0} metadata change(s)`,
		`responseId: ${responseId}`,
	];
	return parts.join(" · ");
}

function diffLabel(diff: SnapshotDiffResult): string {
	return ` ${baselineLabel(diff)}`;
}

function baselineLabel(diff: SnapshotDiffResult): string {
	const snapshot = diff.snapshotName ? `snapshot '${diff.snapshotName}'` : "snapshot";
	const tag = diff.snapshotTag ? ` tag '${diff.snapshotTag}'` : "";
	const baseline = diff.compareTag ? ` compared to tag '${diff.compareTag}'` : "";
	return `${snapshot}${tag}${baseline}`;
}

function shapeDiffResult(
	diff: SnapshotDiffResult,
	responseId: string,
	baselineFreshness?: ReturnType<typeof baselineFreshnessFor>,
) {
	const interpretation = diffInterpretation(diff);
	const sourceUrl = diff.current.finalUrl ?? diff.current.url;
	const baselineWarning = baselineFreshness?.stale
		? `Baseline snapshot is ${formatAge(baselineFreshness.ageSeconds)} old; refresh or save a newer snapshot before relying on time-sensitive comparisons.`
		: undefined;
	return {
		summary: interpretation,
		answerContext: [
			interpretation,
			diff.previous
				? `Compared current content against ${baselineLabel(diff)}.`
				: "No previous snapshot existed; this run established the baseline.",
			baselineWarning,
			`Use responseId ${responseId} to inspect the full diff, hashes, headings, links, metadata changes, and snapshot metadata.`,
		]
			.filter(Boolean)
			.join("\n"),
		...storedTraceContext({
			responseId,
			source: {
				id: "current",
				uri: sourceUrl,
				excerpt: diff.current.content.text.slice(0, 240),
				relevance: "Current scraped page used for snapshot comparison.",
				retrievedAt: diff.current.metadata.timestamp,
				sourceType: "docs",
			},
			retrieveDescription: "Inspect the full stored diff result.",
			guidanceSuffix:
				"For changed diffs, inspect added/removed sections before answering from an older snapshot.",
		}),
		qualitySignals: {
			confidence: baselineFreshness?.stale ? ("medium" as const) : ("high" as const),
			freshness: baselineFreshness?.stale ? ("stale_possible" as const) : ("current" as const),
			coverage: "complete" as const,
			knownGaps: [
				!diff.previous
					? "This was the first snapshot, so no previous content was available for comparison."
					: undefined,
				baselineWarning,
			].filter(Boolean) as string[],
		},
	};
}
