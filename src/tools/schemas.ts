/**
 * @fileoverview Shared TypeBox parameter schemas for Pi web tools.
 */
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.js";

export const scrapeModeSchema = StringEnum(SCRAPE_MODES);
export const outputFormatSchema = StringEnum(OUTPUT_FORMATS);

export const scrapeModeOptionSchema = {
	mode: Type.Optional(scrapeModeSchema),
} as const;

export const scrapeOutputOptionSchema = {
	...scrapeModeOptionSchema,
	format: Type.Optional(outputFormatSchema),
} as const;

export function urlProperty(
	description?: string,
): ReturnType<typeof Type.String> {
	return description ? Type.String({ description }) : Type.String();
}
