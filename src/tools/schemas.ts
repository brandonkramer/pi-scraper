/**
 * @fileoverview Shared TypeBox parameter schemas for Pi web tools.
 */
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.js";

export const scrapeModeSchema = StringEnum(SCRAPE_MODES);
export const outputFormatSchema = StringEnum(OUTPUT_FORMATS);

export const headersSchema = Type.Record(Type.String(), Type.String());

export const commonRequestSchema = {
	timeoutSeconds: Type.Optional(Type.Any()),
	maxChars: Type.Optional(Type.Any()),
	proxy: Type.Optional(Type.Any()),
	respectRobots: Type.Optional(Type.Any()),
	refresh: Type.Optional(Type.Any()),
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
	include: Type.Optional(Type.Array(Type.Any())),
	exclude: Type.Optional(Type.Array(Type.Any())),
	onlyMainContent: Type.Optional(Type.Any()),
	...commonRequestSchema,
} as const;

export const crawlScrapeOptionSchema = {
	...scrapeModeOptionSchema,
	include: Type.Optional(Type.Array(Type.Any())),
	exclude: Type.Optional(Type.Array(Type.Any())),
} as const;

export function urlProperty(
	description?: string,
): ReturnType<typeof Type.String> {
	return description ? Type.String({ description }) : Type.String();
}
