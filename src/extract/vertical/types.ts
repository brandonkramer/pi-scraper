/** @file Vertical extraction types. */
import type { ExtractorCapability, SourceReference } from "../../types.ts";

export interface VerticalExtractorPage {
	text: string;
	finalUrl: string;
	status: number;
	contentType?: string;
	html?: string;
	requestedUrl?: string;
}

export interface VerticalExtractorProgress {
	state: string;
	message?: string;
	url?: string;
}

export interface VerticalExtractorContext {
	/** Manifest-level options passed into primitive extractors (e.g. code-extract). */
	manifest?: Record<string, unknown>;
	/** @deprecated Use manifest */
	recipe?: Record<string, unknown>;
	fetchJson<T = unknown>(url: string, signal?: AbortSignal): Promise<T>;
	fetchJsonPost?<T = unknown>(url: string, body: unknown, signal?: AbortSignal): Promise<T>;
	/**
	 * Generic fetch with method, headers, and body support. Used by declarative manifests with custom
	 * HTTP method/headers/body templates.
	 */
	fetch?(
		url: string,
		opts?: {
			method?: "GET" | "POST" | "PUT" | "DELETE";
			headers?: Record<string, string>;
			body?: string;
		},
		signal?: AbortSignal,
	): Promise<{ data: unknown; status: number }>;
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
