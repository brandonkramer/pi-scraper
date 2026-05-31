/** @file Pi tool adapter for stored result, job, and snapshot lookup. */
import { type Static, Type } from "typebox";

import { listSnapshots } from "../diff/snapshots.ts";
import { getJobManifest } from "../storage/jobs/manifest.ts";
import { readResponse } from "../storage/responses/read.ts";
import { toolCall } from "../tui/index.ts";
import { renderGetResult } from "../tui/renderers/get-result.ts";
import type { PiToolShell, ToolContext, StructuredError } from "../types.ts";
import { defineWebTool } from "./infra/define.ts";
import { errorResult, structuredToolError, toolResult } from "./infra/result.ts";

export const webGetResultSchema = Type.Object({
	responseId: Type.Optional(Type.String()),
	jobId: Type.Optional(Type.String()),
	snapshotUrl: Type.Optional(Type.String()),
	snapshotName: Type.Optional(Type.String()),
	snapshotTag: Type.Optional(Type.String()),
});

type Params = Static<typeof webGetResultSchema>;

export const webGetResultTool = defineWebTool({
	name: "web_get_result",
	label: "Get",
	description: "Retrieve stored response",
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
		toolCall(
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
		const entries = await listSnapshots({ url: snapshotUrl, snapshotName, snapshotTag });
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

function getResultError(error: StructuredError): PiToolShell<ToolContext<undefined>> {
	return { ...errorResult(error), isError: true };
}

function summarizeData(value: unknown): string {
	if (value === null || value === undefined) return "done";
	if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (typeof value === "object") {
		const k = Object.keys(value).length;
		return `${k} field${k === 1 ? "" : "s"}`;
	}
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}
