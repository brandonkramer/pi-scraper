import { type Static, Type } from "@mariozechner/pi-ai";
import { getJobManifest } from "../storage/jobs.js";
import { getStoredResult } from "../storage/results.js";
import { defineWebTool } from "./define.js";
import {
	renderEnvelopeResult,
	renderSimpleCall,
	summarizeData,
} from "./render.js";
import { errorResult, structuredToolError, toolResult } from "./result.js";

export const webGetResultSchema = Type.Object({
	responseId: Type.Optional(Type.String()),
	jobId: Type.Optional(Type.String()),
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
		return errorResult({
			code: "GET_RESULT_INPUT_MISSING",
			phase: "retrieve",
			message: "Provide responseId or jobId.",
			retryable: false,
		});
	},
	renderCall: (args, theme) =>
		renderSimpleCall(
			"web_get_result",
			[args.jobId ? `job:${args.jobId}` : args.responseId],
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

async function getResponse(responseId: string) {
	try {
		const stored = await getStoredResult(responseId);
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
