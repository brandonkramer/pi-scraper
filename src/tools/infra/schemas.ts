/**
 * @fileoverview Shared TypeBox parameter schemas for Pi web tools.
 */
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../../defaults.ts";

export const scrapeModeSchema = StringEnum(SCRAPE_MODES);
export const outputFormatSchema = StringEnum(OUTPUT_FORMATS);

export const scrapeModeOptionSchema = {
	mode: Type.Optional(scrapeModeSchema),
} as const;

export const sessionOptionSchema = {
	sessionId: Type.Optional(
		Type.String({
			description:
				"Use only when prior state matters: cookies, login, consent, locale, cart, dashboard, or multi-step crawl/batch.",
		}),
	),
	saveSession: Type.Optional(
		Type.Boolean({
			description:
				"Persist sessionId cookies/profile across Pi reloads for later tool calls.",
		}),
	),
	clearSession: Type.Optional(
		Type.Boolean({
			description: "Delete saved and in-memory state for sessionId.",
		}),
	),
} as const;

export const scrapeOutputOptionSchema = {
	...scrapeModeOptionSchema,
	format: Type.Optional(outputFormatSchema),
	...sessionOptionSchema,
	stealth: Type.Optional(Type.Any()),
	autoWait: Type.Optional(Type.Any()),
} as const;

export function urlProperty(
	description?: string,
): ReturnType<typeof Type.String> {
	return description ? Type.String({ description }) : Type.String();
}
