import { type Static, Type } from "@mariozechner/pi-ai";
import { defineWebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { errorResult, missingModelError } from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webSummarizeSchema = Type.Object({
	url: Type.Optional(urlProperty("Page URL to scrape before summarization.")),
	content: Type.Optional(
		Type.String({
			description: "Already scraped/provided content to summarize.",
		}),
	),
	sentences: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	bullets: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	...scrapeOptionSchema,
});

type Params = Static<typeof webSummarizeSchema>;

export const webSummarizeTool = defineWebTool({
	name: "web_summarize",
	label: "Web Summarize",
	description:
		"Page-scoped summary after scraping. Requires Pi model/LLM execution; use a dedicated research/search extension for multi-source synthesis.",
	parameters: webSummarizeSchema,
	async execute(_toolCallId, params: Params) {
		return errorResult(
			missingModelError("summarize", params.url),
			"web_summarize requires a model-backed adapter; web_scrape can return source text locally.",
		);
	},
	renderCall: (args, theme) =>
		renderSimpleCall(
			"web_summarize",
			[
				args.url ?? "provided content",
				args.bullets
					? `${args.bullets} bullets`
					: `${args.sentences ?? 3} sentences`,
			],
			theme,
		),
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
});
