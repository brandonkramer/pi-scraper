import { StringEnum, Type } from "@mariozechner/pi-ai";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.js";

export const scrapeModeSchema = StringEnum(SCRAPE_MODES);
export const outputFormatSchema = StringEnum(OUTPUT_FORMATS);

export const headersSchema = Type.Record(Type.String(), Type.String());

export const commonRequestSchema = {
	timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })),
	maxChars: Type.Optional(Type.Number({ minimum: 1000 })),
	proxy: Type.Optional(Type.String()),
	respectRobots: Type.Optional(Type.Boolean()),
	refresh: Type.Optional(Type.Boolean()),
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
	...commonRequestSchema,
} as const;

export const crawlScrapeOptionSchema = {
	...scrapeModeOptionSchema,
	include: Type.Optional(Type.Array(Type.String())),
	exclude: Type.Optional(Type.Array(Type.String())),
} as const;

export function urlProperty(
	description?: string,
): ReturnType<typeof Type.String> {
	return description ? Type.String({ description }) : Type.String();
}
