import { Type } from "@mariozechner/pi-ai";
import { listExtractorCapabilities } from "../extract/registry.js";
import { defineWebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";

export const webListExtractorsSchema = Type.Object({});

export const webListExtractorsTool = defineWebTool({
	name: "web_list_extractors",
	label: "Web List Extractors",
	description:
		"List vertical extractors, URL patterns, schemas, and browser/cloud/LLM needs.",
	parameters: webListExtractorsSchema,
	async execute() {
		const capabilities = listExtractorCapabilities();
		return toolResult({
			text: `${capabilities.length} extractor(s): ${capabilities.map((item) => item.name).join(", ")}`,
			data: capabilities,
			format: "json",
		});
	},
	renderCall: (_args, theme) =>
		renderSimpleCall("web_list_extractors", [], theme),
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
});
