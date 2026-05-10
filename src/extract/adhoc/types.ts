/**
 * @fileoverview Ad-hoc extraction types.
 */
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import type { CommonScrapeOptions } from "../../types.ts";

export interface AdHocExtractOptions extends CommonScrapeOptions {
	url?: string;
	content?: string;
	prompt?: string;
	schema?: unknown;
}

export interface AdHocExtractResult<T = unknown> {
	input: { url?: string; source: "provided" | "scrape"; scrape?: ScrapeResult };
	data: T;
	raw?: unknown;
}

export class MissingExtractInputError extends Error {
	constructor() {
		super("extractAdHoc requires url or content");
		this.name = "MissingExtractInputError";
	}
}
