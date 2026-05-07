import { StringEnum, Type } from "@mariozechner/pi-ai";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.js";

export const scrapeModeSchema = StringEnum(SCRAPE_MODES, {
	description: "Default auto.",
});
export const outputFormatSchema = StringEnum(OUTPUT_FORMATS);

export const headersSchema = Type.Record(Type.String(), Type.String());

export const commonRequestSchema = {
	timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })),
	maxBytes: Type.Optional(Type.Number({ minimum: 1024 })),
	maxChars: Type.Optional(Type.Number({ minimum: 1000 })),
	headers: Type.Optional(headersSchema),
	proxy: Type.Optional(
		Type.String({
			description: "Proxy URL.",
		}),
	),
	respectRobots: Type.Optional(Type.Boolean({ description: "Default true." })),
	cacheTtlSeconds: Type.Optional(
		Type.Number({
			minimum: 1,
			description: "Opt-in cache TTL seconds.",
		}),
	),
	maxAgeSeconds: Type.Optional(
		Type.Number({
			minimum: 1,
			description: "Hard max cache age seconds.",
		}),
	),
	refresh: Type.Optional(
		Type.Boolean({
			description: "Bypass cache; fetch fresh.",
		}),
	),
} as const;

export const scrapeModeOptionSchema = {
	mode: Type.Optional(scrapeModeSchema),
} as const;

export const scrapeOutputOptionSchema = {
	...scrapeModeOptionSchema,
	format: Type.Optional(outputFormatSchema),
} as const;

export const scrapeOptionSchema = {
	...scrapeOutputOptionSchema,
	include: Type.Optional(Type.Array(Type.String())),
	exclude: Type.Optional(Type.Array(Type.String())),
	onlyMainContent: Type.Optional(Type.Boolean()),
	removeImages: Type.Optional(Type.Boolean()),
	browserProfile: Type.Optional(Type.String()),
	osProfile: Type.Optional(Type.String()),
	...commonRequestSchema,
} as const;

export const crawlScrapeOptionSchema = {
	...scrapeModeOptionSchema,
	include: Type.Optional(Type.Array(Type.String())),
	exclude: Type.Optional(Type.Array(Type.String())),
} as const;

export function urlProperty(
	description = "URL",
): ReturnType<typeof Type.String> {
	return Type.String({ description });
}
