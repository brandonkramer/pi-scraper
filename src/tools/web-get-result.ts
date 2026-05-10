/**
 * @fileoverview Pi tool adapter for stored result, job, and snapshot lookup.
 */
import { type Static, Type } from "@earendil-works/pi-ai";
import { listSnapshots } from "../diff/snapshots.ts";
import { getJobManifest } from "../storage/jobs/manifest.ts";
import { readResponse } from "../storage/responses/read.ts";
import { defineWebTool } from "./define.ts";
import { renderEnvelopeResult } from "../tui/envelope.ts";
import { renderSimpleCall } from "../tui/simple-call.ts";
import { errorResult, structuredToolError, toolResult } from "./result.ts";

export const webGetResultSchema = Type.Object({
	responseId: Type.Optional(Type.Any()),
	jobId: Type.Optional(Type.Any()),
	snapshotUrl: Type.Optional(Type.Any()),
	snapshotName: Type.Optional(Type.Any()),
	snapshotTag: Type.Optional(Type.Any()),
});

type Params = Static<typeof webGetResultSchema>;

export const webGetResultTool = defineWebTool({
	name: "web_get_result",
	label: "Get",
	description: "Retrieve stored response or job manifest",
	parameters: webGetResultSchema,
	async execute(_toolCallId, params: Params) {
		if (params.jobId) return getJob(params.jobId);
		if (params.responseId) return getResponse(params.responseId);
		if (params.snapshotUrl)
			return getSnapshotList(
				params.snapshotUrl,
				params.snapshotName,
				params.snapshotTag,
			);
		return errorResult({
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
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
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
		return errorResult(
			structuredToolError(error, "JOB_MANIFEST_NOT_FOUND", "retrieve"),
		);
	}
}

async function getSnapshotList(
	snapshotUrl: string,
	snapshotName?: string,
	snapshotTag?: string,
) {
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
				"Snapshot listings include local paths plus metadata such as timestamp, mode, snapshotName, and snapshotTag for selecting web_diff compareTag baselines.",
		});
	} catch (error) {
		return errorResult(
			structuredToolError(
				error,
				"SNAPSHOT_LIST_FAILED",
				"retrieve",
				snapshotUrl,
			),
		);
	}
}

async function getResponse(responseId: string) {
	try {
		const stored = await readResponse(responseId);
		return toolResult({
			text: `Stored result ${responseId}: ${summarizeData(stored.value)}`,
			data: stored.value,
			format: stored.metadata.contentType?.includes("json")
				? "json"
				: undefined,
			responseId,
			fullOutputPath: stored.metadata.fullOutputPath,
			contentType: stored.metadata.contentType,
			summary: `Retrieved stored response ${responseId}.`,
		});
	} catch (error) {
		return errorResult(
			structuredToolError(error, "STORED_RESULT_NOT_FOUND", "retrieve"),
		);
	}
}

function summarizeData(value: unknown): string {
	if (Array.isArray(value))
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (value && typeof value === "object")
		return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
	return String(value ?? "done");
}
