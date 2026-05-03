import { Type, type Static } from "@mariozechner/pi-ai";
import { defineWebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { errorResult, missingModelError } from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webExtractSchema = Type.Object({
  url: Type.Optional(urlProperty("Page URL to scrape before extraction.")),
  content: Type.Optional(Type.String({ description: "Already scraped/provided content to extract from." })),
  prompt: Type.Optional(Type.String({ description: "Natural-language extraction instructions." })),
  schema: Type.Optional(Type.Unknown({ description: "Desired JSON schema for extraction." })),
  ...scrapeOptionSchema,
});

type Params = Static<typeof webExtractSchema>;

export const webExtractTool = defineWebTool({
  name: "web_extract",
  label: "Web Extract",
  description: "Ad hoc JSON/schema extraction from one page. Scrapes clean text first, then requires Pi model/LLM execution; use web_vertical_scrape for deterministic known-site extractors.",
  parameters: webExtractSchema,
  async execute(_toolCallId, params: Params) {
    return errorResult(missingModelError("extract", params.url), "web_extract requires a model-backed adapter; deterministic extractors are available through web_vertical_scrape.");
  },
  renderCall: (args, theme) => renderSimpleCall("web_extract", [args.url ?? "provided content"], theme),
  renderResult: (result, { expanded }) => renderEnvelopeResult(result, expanded),
});
