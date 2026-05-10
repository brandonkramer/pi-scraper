/**
 * @fileoverview Shared context-package storage flow for web tools.
 */
import {
	compileContext,
	type CompiledContext,
	type ContextSource,
} from "../../extract/context/index.ts";
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import { writeCrawlContextFile } from "./write-crawl-file.ts";
import { storeResponse } from "../responses/store.ts";

export interface ContextPageInput {
	url: string;
	result: ScrapeResult;
	responseId?: string;
}

export interface StoredCompiledContext {
	value: CompiledContext;
	responseId: string;
	fullOutputPath: string;
	crawlPackagePath?: string;
}

export async function storeCompiledContext(input: {
	source: ContextSource;
	crawlId?: string;
	batchId?: string;
	pages: readonly ContextPageInput[];
	persistCrawlPackage?: boolean;
}): Promise<StoredCompiledContext> {
	const value = compileContext({
		source: input.source,
		crawlId: input.crawlId,
		batchId: input.batchId,
		pages: input.pages,
	});
	const stored = await storeResponse(value);
	const crawlFile = input.persistCrawlPackage
		? await writeCrawlContextFile(requiredCrawlId(input), value)
		: undefined;
	return {
		value,
		responseId: stored.responseId,
		fullOutputPath: stored.fullOutputPath,
		crawlPackagePath: crawlFile?.path,
	};
}

function requiredCrawlId(input: { crawlId?: string }): string {
	if (!input.crawlId)
		throw new Error("crawlId is required for crawl package persistence");
	return input.crawlId;
}
