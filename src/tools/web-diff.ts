import { randomUUID } from "node:crypto";
import { type Static, Type } from "@mariozechner/pi-ai";
import {
	diffScrapeResult,
	type SnapshotDiffResult,
	updateSnapshotReference,
} from "../diff/snapshots.js";
import { scrapeUrl } from "../scrape/pipeline.js";
import { storeResult } from "../storage/results.js";
import {
	retrieveResultAction,
	sourceNote,
	storedResultGuidance,
} from "./agentic-context.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webDiffSchema = Type.Object({
	url: urlProperty("URL to re-scrape and compare against cached snapshot."),
	snapshotName: Type.Optional(
		Type.String({
			description:
				"Optional human-readable baseline name, such as homepage or docs-home.",
		}),
	),
	...scrapeOptionSchema,
});

type Params = Static<typeof webDiffSchema>;

export const webDiffTool = defineWebTool({
	name: "web_diff",
	label: "Web Diff",
	description:
		"Re-scrape one URL with the shared pipeline, compare to an unnamed or named snapshot, and store deterministic snapshot metadata under ~/.pi/scraper/snapshots/.",
	parameters: webDiffSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		await emitProgress(onUpdate, {
			state: "loading",
			url: params.url,
			message: params.snapshotName
				? `diffing against snapshot '${params.snapshotName}'`
				: "diffing against snapshot",
		});
		const diff = await diffScrapeResult(
			await scrapeUrl(params.url, params, {}, signal),
			{ snapshotName: params.snapshotName },
		);
		const responseId = randomUUID();
		diff.current.metadata.responseId = responseId;
		let stored = await storeResult(diff, {
			responseId,
			contentType: "application/json",
		});
		diff.current.metadata.fullOutputPath = stored.fullOutputPath;
		await updateSnapshotReference(diff.current.url, stored, {
			snapshotName: params.snapshotName,
		});
		stored = await storeResult(diff, {
			responseId,
			contentType: "application/json",
		});
		const text = renderDiffSummary(diff, stored.responseId);
		const shaped = shapeDiffResult(diff, stored.responseId);
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
			...shaped,
		});
	},
	renderCall: (args, theme) =>
		renderSimpleCall(
			"web_diff",
			args.snapshotName
				? [args.url, `snapshot:${args.snapshotName}`]
				: [args.url],
			theme,
		),
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
});

function shapeDiffResult(diff: SnapshotDiffResult, responseId: string) {
	const interpretation = diffInterpretation(diff);
	const sourceUrl = diff.current.finalUrl ?? diff.current.url;
	return {
		summary: interpretation,
		answerContext: [
			interpretation,
			diff.previous
				? `Compared current content against ${diff.snapshotName ? `snapshot '${diff.snapshotName}'` : "the previous unnamed snapshot"}.`
				: "No previous snapshot existed; this run established the baseline.",
			`Use responseId ${responseId} to inspect the full diff, hashes, headings, links, metadata changes, and snapshot metadata.`,
		].join("\n"),
		sourceNotes: [
			sourceNote({
				id: "current",
				uri: sourceUrl,
				excerpt: diff.current.content.text.slice(0, 240),
				relevance: "Current scraped page used for snapshot comparison.",
				retrievedAt: diff.current.metadata.timestamp,
				sourceType: "docs",
			}),
		],
		qualitySignals: {
			confidence: "high" as const,
			freshness: "current" as const,
			coverage: "complete" as const,
			knownGaps: diff.previous
				? undefined
				: [
						"This was the first snapshot, so no previous content was available for comparison.",
					],
		},
		nextActions: [
			retrieveResultAction(responseId, "Inspect the full stored diff result."),
		],
		assistantGuidance: `${storedResultGuidance()} For changed diffs, inspect added/removed sections before answering from an older snapshot.`,
	};
}

export function diffInterpretation(diff: SnapshotDiffResult): string {
	const name = diff.snapshotName
		? ` snapshot '${diff.snapshotName}'`
		: " snapshot";
	if (!diff.previous)
		return `No previous${name}; saved a baseline for future comparisons.`;
	if (diff.summary?.unchangedAfterNormalization)
		return `No meaningful content changes after normalization for${name}; prior content is effectively equivalent.`;
	const changed = diff.diff?.changedCount ?? 0;
	const added = diff.diff?.addedCount ?? 0;
	const removed = diff.diff?.removedCount ?? 0;
	const headingChanges =
		(diff.summary?.addedHeadings.length ?? 0) +
		(diff.summary?.removedHeadings.length ?? 0);
	const linkChanges =
		(diff.summary?.addedLinks.length ?? 0) +
		(diff.summary?.removedLinks.length ?? 0);
	if (
		changed === 0 &&
		added === 0 &&
		removed === 0 &&
		headingChanges === 0 &&
		linkChanges === 0
	) {
		return `No content changes detected for${name}; current and previous snapshots match.`;
	}
	return `Content changed for${name}: ${changed} changed, ${added} added, ${removed} removed line(s), ${headingChanges} heading change(s), ${linkChanges} link change(s).`;
}

function renderDiffSummary(
	diff: SnapshotDiffResult,
	responseId: string,
): string {
	const name = diff.snapshotName
		? ` snapshot '${diff.snapshotName}'`
		: " snapshot";
	if (!diff.previous)
		return `No previous${name}; saved baseline. responseId: ${responseId}`;
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
