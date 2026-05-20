/** @file Vertical extraction types. */
import type { ExtractorCapability, SourceReference } from "../../types.ts";

export interface VerticalExtractorPage {
	text: string;
	finalUrl: string;
	status: number;
	contentType?: string;
}

export interface VerticalExtractorProgress {
	state: string;
	message?: string;
	url?: string;
}

export interface VerticalExtractorContext {
	fetchJson<T = unknown>(url: string, signal?: AbortSignal): Promise<T>;
	fetchJsonPost?<T = unknown>(url: string, body: unknown, signal?: AbortSignal): Promise<T>;
	fetchText?(url: string, signal?: AbortSignal): Promise<string>;
	fetchPage?(url: string, signal?: AbortSignal): Promise<VerticalExtractorPage>;
	emitProgress?(options: VerticalExtractorProgress): void | Promise<void>;
}

export interface VerticalExtractionResult<T = unknown> {
	extractor: string;
	url: string;
	data?: T;
	sources?: SourceReference[];
	error?: { code: string; message: string; retryable: boolean };
}

export interface VerticalExtractor<T = unknown> {
	capability: ExtractorCapability;
	match(url: URL): Record<string, string> | undefined;
	extract(
		url: URL,
		match: Record<string, string>,
		context: VerticalExtractorContext,
		signal?: AbortSignal,
	): Promise<T>;
}
