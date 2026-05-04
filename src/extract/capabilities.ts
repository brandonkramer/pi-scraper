import type { ExtractorCapability, SourceReference } from "../types.js";

export interface VerticalExtractorContext {
	fetchJson<T = unknown>(url: string, signal?: AbortSignal): Promise<T>;
	fetchText?(url: string, signal?: AbortSignal): Promise<string>;
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

export function capability(
	name: string,
	urlPatterns: string[],
	schema: unknown,
	requirements: Partial<
		Pick<
			ExtractorCapability,
			"requiresBrowser" | "requiresLLM" | "requiresCloud"
		>
	> = {},
): ExtractorCapability {
	return {
		name,
		urlPatterns,
		requiresBrowser: requirements.requiresBrowser ?? false,
		requiresLLM: requirements.requiresLLM ?? false,
		requiresCloud: requirements.requiresCloud ?? false,
		schema,
	};
}
