/**
 * @fileoverview Scrape option resolution — merges config, session, and explicit params.
 */
import type { FetchSession } from "../http/session.ts";
import type { ScrapeMode, OutputFormat } from "../types.ts";

export interface ResolvedScrapeOptions {
	mode: ScrapeMode;
	format: OutputFormat;
	browserProfile?: string;
	proxy?: string;
	headers?: Record<string, string>;
	[key: string]: unknown;
}

export function resolveScrapeOptions(
	params: {
		mode?: ScrapeMode;
		format?: OutputFormat | string;
		browserProfile?: string;
		proxy?: string;
		headers?: Record<string, string>;
		[key: string]: unknown;
	},
	config: {
		scrapeDefaults?: Record<string, unknown>;
		scrapeMode: ScrapeMode;
		outputFormat: OutputFormat;
	},
	session?: FetchSession,
): ResolvedScrapeOptions {
	const mode = params.mode ?? session?.defaultMode ?? config.scrapeMode;
	const format =
		(params.format as OutputFormat | undefined) ?? config.outputFormat;
	return {
		...config.scrapeDefaults,
		...(session
			? {
					browserProfile: session.defaultBrowserProfile,
					proxy: session.defaultProxy,
					headers: session.defaultHeaders,
				}
			: {}),
		...params,
		mode,
		format,
	} as ResolvedScrapeOptions;
}
