/**
 * @fileoverview Context-package types.
 */
import type { ScrapeResult } from "../../scrape/pipeline.ts";

export type ContextPackageSource = "crawl" | "batch";

export interface ContextPackagePage {
	url: string;
	result: ScrapeResult;
	responseId?: string;
}

export interface ContextPackageMetadata {
	source: ContextPackageSource;
	crawlId?: string;
	batchId?: string;
	createdAt: string;
	urlCount: number;
	totalChars: number;
	truncated: boolean;
}

export interface ContextPackageEntry {
	url: string;
	title?: string;
	breadcrumbs?: string[];
	summary?: string;
	children?: Array<{ url: string; title?: string }>;
	contentRef?: string;
	excerpt?: string;
}

export interface ContextPackage {
	package: ContextPackageMetadata;
	tree: ContextPackageEntry[];
}

export interface BuildContextPackageInput {
	source: ContextPackageSource;
	crawlId?: string;
	batchId?: string;
	pages: readonly ContextPackagePage[];
	createdAt?: string;
	maxBytes?: number;
}
