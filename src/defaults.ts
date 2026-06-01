/** @file Defaults module. */
import type { OutputFormat, ScrapeMode } from "./types.ts";

export const DEFAULT_USER_AGENT = "pi-scraper/0.1 (+https://www.npmjs.com/package/pi-scraper)";

export const SCRAPE_MODES = [
	"fast",
	"fingerprint",
	"readable",
	"browser",
	"auto",
] as const satisfies readonly ScrapeMode[];

export const OUTPUT_FORMATS = [
	"markdown",
	"text",
	"llm",
	"html",
	"json",
	"raw",
	"ax-tree",
] as const satisfies readonly OutputFormat[];

export const DEFAULT_SCRAPE_MODE: ScrapeMode = "auto";
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = "markdown";
export const DEFAULT_TIMEOUT_SECONDS = 20;
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_CHARS = 50_000;
export const DEFAULT_CHUNK_MAX_TOKENS = 500;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 50;
export const DEFAULT_RESPECT_ROBOTS = true;
export const DEFAULT_BROWSER_BACKEND = "cloak" as const;

export const PI_TRUNCATION_LIMITS = {
	maxBytes: 50 * 1024,
	maxLines: 2_000,
} as const;

export const DEFAULT_CONCURRENCY = {
	global: 8,
	perHost: 2,
} as const;

export const DEFAULT_CRAWL_LIMITS = {
	maxPages: 50,
	maxDepth: 3,
	sameOrigin: true,
} as const;

export const DEFAULT_RETRY = {
	attempts: 2,
	baseDelayMs: 250,
	maxDelayMs: 5_000,
	jitterMs: 250,
} as const;

export const COMMON_TRACKING_QUERY_PARAMS = [
	"fbclid",
	"gclid",
	"igshid",
	"mc_cid",
	"mc_eid",
	"msclkid",
	"utm_campaign",
	"utm_content",
	"utm_medium",
	"utm_source",
	"utm_term",
] as const;
