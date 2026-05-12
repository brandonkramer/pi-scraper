/** @file Shared TypeBox parameter schemas for Pi web tools. */
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
			description: "Use when prior state matters: cookies, login, multi-step flows.",
		}),
	),
	saveSession: Type.Optional(
		Type.Boolean({
			description: "Persist sessionId across Pi reloads.",
		}),
	),
	clearSession: Type.Optional(
		Type.Boolean({
			description: "Delete sessionId state.",
		}),
	),
} as const;

export const modelProviderOptionSchema = {
	provider: Type.Optional(
		Type.String({
			description: "Model adapter id, 'auto' (default), or 'off'.",
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

export function urlProperty(description?: string): ReturnType<typeof Type.String> {
	return description ? Type.String({ description }) : Type.String();
}
