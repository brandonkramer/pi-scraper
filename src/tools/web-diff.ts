/** @file Pi tool adapter for URL snapshot diffing. */
import { randomUUID } from "node:crypto";

import { type Static, Type } from "@earendil-works/pi-ai";

import { loadEffectiveConfig } from "../config/settings.ts";
import {
	diffScrapeResult,
	type SnapshotDiffResult,
	updateSnapshotReference,
} from "../diff/snapshots.ts";
import { formatAge } from "../scrape/describe.ts";
import { scrapeUrl } from "../scrape/pipeline.ts";
import { freshnessFromTimestamp } from "../storage/cache/freshness.ts";
import {
	appendJobError,
	structuredErrorToJobError,
	unknownToJobError,
	type JobError,
} from "../storage/jobs/errors.ts";
import {
	createJobManifest,
	updateJobManifest,
	writeJobManifest,
} from "../storage/jobs/manifest.ts";
import { storeResponseWithId } from "../storage/responses/store.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { storedTraceContext } from "./infra/agentic-context.ts";
import { defineWebTool } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { errorResult, structuredToolError, toolResult } from "./infra/result.ts";
import { scrapeModeOptionSchema, urlProperty } from "./infra/schemas.ts";
import { renderWebDiffResult } from "./renderers/diff.ts";

export const webDiffSchema = Type.Object({
	url: urlProperty(),
	snapshotName: Type.Optional(Type.String()),
	snapshotTag: Type.Optional(Type.String()),
	compareTag: Type.Optional(Type.String()),
	maxSnapshotAgeSeconds: Type.Optional(Type.Any()),
	...scrapeModeOptionSchema,
});

type Params = Static<typeof webDiffSchema>;

export const webDiffTool = defineWebTool({
	name: "web_diff",
	label: "Diff",
	description: "Compare snapshot",
	parameters: webDiffSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const config = await loadEffectiveConfig();
		const jobId = randomUUID();
		let errors: JobError[] = [];
		const manifestPath = await writeJobManifest(
			createJobManifest({
				jobId,
				jobType: "diff",
				params,
				mode: params.mode ?? config.scrapeMode,
				format: "json",
			}),
		);
		await emitProgress(onUpdate, {
			state: "loading",
			url: params.url,
			message: diffProgressMessage(params),
		});
		await updateJobManifest(jobId, {
			status: "running",
			startedAt: new Date().toISOString(),
		});
		try {
			const scrape = await scrapeUrl(
				params.url,
				{
					...config.scrapeDefaults,
					...params,
					mode: params.mode ?? config.scrapeMode,
					format: config.outputFormat,
				},
				{},
				signal,
			);
			if (scrape.error) errors = appendJobError(errors, structuredErrorToJobError(scrape.error));
			const diff = await diffScrapeResult(scrape, {
				snapshotName: params.snapshotName,
				snapshotTag: params.snapshotTag,
				compareTag: params.compareTag,
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
				snapshotName: params.snapshotName,
				snapshotTag: params.snapshotTag,
			});
			await updateJobManifest(jobId, {
				status: errors.length ? "error" : "done",
				completedAt: new Date().toISOString(),
				urlsProcessed: 1,
				urlsFailed: errors.length ? 1 : 0,
				errors,
				totalBytes: diff.current.metadata.contentLength,
				totalChars: diff.current.content.text.length,
				truncatedPages: scrape.truncated ? 1 : 0,
				responseIds: [stored.responseId],
				snapshots: {
					previous: diff.previous?.metadata,
					current: diff.current.metadata,
					path: diff.snapshotPath,
					snapshotName: diff.snapshotName,
					snapshotTag: diff.snapshotTag,
					compareTag: diff.compareTag,
				},
			});
			const baselineFreshness = baselineFreshnessFor(diff, params.maxSnapshotAgeSeconds);
			const text = renderDiffSummary(diff, stored.responseId);
			const shaped = shapeDiffResult(diff, stored.responseId, baselineFreshness);
			return toolResult({
				text,
				data: diff,
				url: params.url,
				finalUrl: diff.current.finalUrl,
				mode: diff.current.metadata.mode,
				format: "json",
				responseId: stored.responseId,
				fullOutputPath: stored.fullOutputPath,
				contentType: "application/json",
				freshness: baselineFreshness,
				diagnostics: { jobId, jobManifestPath: manifestPath },
				...shaped,
			});
		} catch (error) {
			errors = appendJobError(errors, unknownToJobError(error, "diff", params.url));
			await updateJobManifest(jobId, {
				status: signal.aborted ? "paused" : "error",
				completedAt: new Date().toISOString(),
				urlsProcessed: 1,
				urlsFailed: 1,
				errors,
			});
			if (typeof error === "object" && error !== null && "structured" in error)
				return errorResult(structuredToolError(error, "SNAPSHOT_DIFF_FAILED", "diff", params.url));
			throw error;
		}
	},
	renderCall: (args, theme, _context) =>
		renderSimpleCall(
			"web_diff",
			[
				args.url,
				args.snapshotName ? `snapshot:${args.snapshotName}` : undefined,
				args.snapshotTag ? `tag:${args.snapshotTag}` : undefined,
				args.compareTag ? `compare:${args.compareTag}` : undefined,
			],
			theme,
		),
	renderResult: (result, { expanded }, theme) => renderWebDiffResult(result, expanded, theme),
});

function diffProgressMessage(params: Params): string {
	const labels = [
		params.snapshotName ? `snapshot '${params.snapshotName}'` : undefined,
		params.compareTag ? `tag '${params.compareTag}'` : undefined,
	].filter(Boolean);
	return labels.length ? `diffing against ${labels.join(" ")}` : "diffing against snapshot";
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
