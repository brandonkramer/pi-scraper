import { type Static, Type } from "@mariozechner/pi-ai";
import { getStoredResult } from "../storage/results.js";
import { defineWebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { structuredToolError, toolResult } from "./result.js";

export const webGetResultSchema = Type.Object({
	responseId: Type.String({
		description:
			"Stored response id returned by crawl, batch, or large scrape results.",
	}),
});

type Params = Static<typeof webGetResultSchema>;

export const webGetResultTool = defineWebTool({
	name: "web_get_result",
	label: "Web Get Result",
	description:
		"Retrieve full locally stored output by responseId from prior large web tool calls.",
	parameters: webGetResultSchema,
	async execute(_toolCallId, params: Params) {
		try {
			const stored = await getStoredResult(params.responseId);
			return toolResult({
				text: `Retrieved ${params.responseId}`,
				data: stored.value,
				responseId: stored.metadata.responseId,
				fullOutputPath: stored.metadata.fullOutputPath,
				contentType: stored.metadata.contentType,
			});
		} catch (resultError) {
			const structured = structuredToolError(
				resultError,
				"RESULT_NOT_FOUND",
				"storage",
			);
			return toolResult({
				text: `Result not found: ${params.responseId}`,
				data: undefined,
				responseId: params.responseId,
				error: structured,
			});
		}
	},
	renderCall: (args, theme) =>
		renderSimpleCall("web_get_result", [args.responseId], theme),
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
});
