/**
 * @fileoverview Shared context-package storage flow for web tools.
 */
import {
	buildContextPackage,
	type ContextPackage,
	type ContextPackageSource,
} from "../../extract/context-package/index.ts";
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import { writeCrawlContextPackage } from "./write-crawl-file.ts";
import { storeResponse } from "../responses/store.ts";

export interface ContextPackagePageInput {
	url: string;
	result: ScrapeResult;
	responseId?: string;
}

export interface StoredContextPackage {
	value: ContextPackage;
	responseId: string;
	fullOutputPath: string;
	crawlPackagePath?: string;
}

export async function buildStoredContextPackage(input: {
	source: ContextPackageSource;
	crawlId?: string;
	batchId?: string;
	pages: readonly ContextPackagePageInput[];
	persistCrawlPackage?: boolean;
}): Promise<StoredContextPackage> {
	const value = buildContextPackage({
		source: input.source,
		crawlId: input.crawlId,
		batchId: input.batchId,
		pages: input.pages,
	});
	const stored = await storeResponse(value);
	const crawlFile = input.persistCrawlPackage
		? await writeCrawlContextPackage(requiredCrawlId(input), value)
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
