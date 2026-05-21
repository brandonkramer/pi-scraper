/** @file Pi tool adapter for stored result, job, and snapshot lookup. */
import { type Static, Type } from "typebox";

import { listSnapshots } from "../diff/snapshots.ts";
import { getJobManifest } from "../storage/jobs/manifest.ts";
import { readResponse } from "../storage/responses/read.ts";
import { paintFirstLineBg } from "../tui/bg-paint.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { buildEnvelopeRows } from "../tui/envelope.ts";
import { defineResultRenderer } from "../tui/result-renderer.ts";
import { paintFg } from "../tui/theme.ts";
import { renderTreeSections } from "../tui/tree.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import type { PiToolShell, ResultEnvelope, StructuredError } from "../types.ts";
import { defineWebTool } from "./infra/define.ts";
import { errorResult, structuredToolError, toolResult } from "./infra/result.ts";

export const webGetResultSchema = Type.Object({
	responseId: Type.Optional(Type.String({ description: "Stored response ID." })),
	jobId: Type.Optional(Type.String({ description: "Job identifier." })),
	snapshotUrl: Type.Optional(Type.String({ description: "Snapshot source URL." })),
	snapshotName: Type.Optional(Type.String({ description: "Snapshot baseline name." })),
	snapshotTag: Type.Optional(Type.String({ description: "Snapshot version tag." })),
});

type Params = Static<typeof webGetResultSchema>;

export const webGetResultTool = defineWebTool({
	name: "web_get_result",
	label: "Get",
	description: "Retrieve stored response or job manifest",
	parameters: webGetResultSchema,
	async execute(_toolCallId, params: Params) {
		if (params.jobId) return await getJob(params.jobId);
		if (params.responseId) return await getResponse(params.responseId);
		if (params.snapshotUrl)
			return await getSnapshotList(params.snapshotUrl, params.snapshotName, params.snapshotTag);
		return getResultError({
			code: "GET_RESULT_INPUT_MISSING",
			phase: "retrieve",
			message: "Provide responseId, jobId, or snapshotUrl.",
			retryable: false,
		});
	},
	renderCall: (args, theme) =>
		renderSimpleCall(
			"web_get_result",
			[
				args.jobId ? `job:${args.jobId}` : args.responseId,
				args.snapshotUrl ? `snapshots:${args.snapshotUrl}` : undefined,
			],
			theme,
		),
	renderResult: (result, { expanded }, theme) => renderGetResult(result, expanded ?? false, theme),
});

async function getJob(jobId: string) {
	try {
		const { manifest, path } = await getJobManifest(jobId);
		return toolResult({
			text: `Job ${manifest.jobId}: ${manifest.jobType} ${manifest.status} · ${manifest.urlsProcessed} processed · ${manifest.urlsFailed} failed`,
			data: manifest,
			format: "json",
			fullOutputPath: path,
			responseId: manifest.jobId,
			summary: `Retrieved ${manifest.jobType} job manifest ${manifest.jobId}.`,
			answerContext:
				"This is a local job manifest with counters, sanitized params, errors, and stored response references. It does not inline page content.",
		});
	} catch (error) {
		return getResultError(structuredToolError(error, "JOB_MANIFEST_NOT_FOUND", "retrieve"));
	}
}

async function getSnapshotList(snapshotUrl: string, snapshotName?: string, snapshotTag?: string) {
	try {
		const entries = await listSnapshots({
			url: snapshotUrl,
			snapshotName,
			snapshotTag,
		});
		return toolResult({
			text: `Found ${entries.length} snapshot(s) for ${snapshotUrl}`,
			data: entries,
			format: "json",
			summary: `Listed ${entries.length} snapshot(s) for ${snapshotUrl}.`,
			answerContext:
				"Snapshot listings include local paths plus metadata such as timestamp, mode, snapshotName, and snapshotTag for selecting web_scrape diff compareTag baselines.",
		});
	} catch (error) {
		return getResultError(
			structuredToolError(error, "SNAPSHOT_LIST_FAILED", "retrieve", snapshotUrl),
		);
	}
}

async function getResponse(responseId: string) {
	try {
		const stored = await readResponse(responseId);
		return toolResult({
			text: `Stored result ${responseId}: ${summarizeData(stored.value)}`,
			data: stored.value,
			format: stored.metadata.contentType?.includes("json") ? "json" : undefined,
			responseId,
			fullOutputPath: stored.metadata.fullOutputPath,
			contentType: stored.metadata.contentType,
			summary: `Retrieved stored response ${responseId}.`,
		});
	} catch (error) {
		return getResultError(structuredToolError(error, "STORED_RESULT_NOT_FOUND", "retrieve"));
	}
}

function getResultError(error: StructuredError): PiToolShell<ResultEnvelope<undefined>> {
	return { ...errorResult(error), isError: true };
}

function summarizeData(value: unknown): string {
	if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (value && typeof value === "object")
		return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
	if (value === null || value === undefined) return "done";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

/** Render web_get_result with a summary header and a field tree in expanded view. */
function renderGetResult(
	result: PiToolShell,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const envelope = result.details as Record<string, unknown> | undefined;
	const hasError = Boolean(envelope?.error);
	const statusLine = hasError
		? paintFg(theme, "error", "✕ no result")
		: paintFg(theme, "accent", "✓ result found");
	const sections = buildEnvelopeRows(envelope);

	return defineResultRenderer({
		renderContent(width) {
			const lines = [`└─ ${statusLine}`];
			if (expanded && sections.length > 0) {
				const tree = renderTreeSections(sections, width, theme);
				if (tree) lines.push("", ...tree.split("\n"));
			}
			return lines.join("\n");
		},
		mapLines: hasError ? (lines) => paintFirstLineBg(lines, "toolErrorBg", theme) : undefined,
	});
}
