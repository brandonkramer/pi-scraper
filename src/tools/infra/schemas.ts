/** @file Shared TypeBox parameter schemas for Pi web tools. */
import { Type } from "typebox";

import { OUTPUT_FORMATS, SCRAPE_MODES } from "../../defaults.ts";
import { StringEnum } from "../../types.ts";

export const scrapeModeSchema = StringEnum(SCRAPE_MODES);
export const outputFormatSchema = StringEnum(OUTPUT_FORMATS);

export const scrapeModeOptionSchema = {
	mode: Type.Optional(scrapeModeSchema),
} as const;

export const sessionOptionSchema = {
	sessionId: Type.Optional(Type.String()),
	saveSession: Type.Optional(Type.Boolean()),
	clearSession: Type.Optional(Type.Boolean()),
} as const;

export const modelProviderOptionSchema = {
	provider: Type.Optional(
		Type.String({
			description: "Model or 'auto'/'off'.",
		}),
	),
} as const;

export const scrapeOutputOptionSchema = {
	...scrapeModeOptionSchema,
	format: Type.Optional(outputFormatSchema),
	...sessionOptionSchema,
	stealth: Type.Optional(Type.Boolean()),
	autoWait: Type.Optional(Type.Boolean()),
	browserBackend: Type.Optional(
		Type.Unsafe<"cloak" | "playwright">({
			description: "Backend (cloak|playwright).",
		}),
	),
} as const;

export function urlProperty(description?: string): ReturnType<typeof Type.String> {
	return description ? Type.String({ description }) : Type.String();
}
