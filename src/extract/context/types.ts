/**
 * @fileoverview Context-package types.
 */
import type { ScrapeResult } from "../../scrape/pipeline.ts";

export type ContextSource = "crawl" | "batch";

export interface ContextPage {
	url: string;
	result: ScrapeResult;
	responseId?: string;
}

export interface ContextMetadata {
	source: ContextSource;
	crawlId?: string;
	batchId?: string;
	createdAt: string;
	urlCount: number;
	totalChars: number;
	truncated: boolean;
}

export interface ContextNode {
	url: string;
	title?: string;
	breadcrumbs?: string[];
	summary?: string;
	children?: Array<{ url: string; title?: string }>;
	contentRef?: string;
	excerpt?: string;
}

export interface CompiledContext {
	package: ContextMetadata;
	tree: ContextNode[];
}

export interface CompileContextInput {
	source: ContextSource;
	crawlId?: string;
	batchId?: string;
	pages: readonly ContextPage[];
	createdAt?: string;
	maxBytes?: number;
}
