/** @file Ad-hoc extraction types. */
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import type { CommonScrapeOptions } from "../../types.ts";
import type { ModelUsage } from "../adhoc/model.ts";
import type { GroundedField } from "../grounding.ts";

export interface AdHocExtractOptions extends CommonScrapeOptions {
	url?: string;
	content?: string;
	prompt?: string;
	schema?: unknown;
}

export interface AdHocExtractResult<T = unknown> {
	input: { url?: string; source: "provided" | "scrape"; scrape?: ScrapeResult };
	data: T;
	/** Source spans for verifiable extracted fields (post-hoc grounding). */
	grounded?: GroundedField[];
	raw?: unknown;
	usage?: ModelUsage;
}

export class MissingExtractInputError extends Error {
	constructor() {
		super("extractAdHoc requires url or content");
		this.name = "MissingExtractInputError";
	}
}
