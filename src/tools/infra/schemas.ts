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
	sessionId: Type.Optional(Type.Unsafe<string>({})),
	saveSession: Type.Optional(Type.Unsafe<boolean>({})),
	clearSession: Type.Optional(Type.Unsafe<boolean>({})),
} as const;

export const modelProviderOptionSchema = {
	provider: Type.Optional(
		Type.Unsafe<string>({ description: "Model/auto/off" }),
	),
} as const;

export const scrapeOutputOptionSchema = {
	...scrapeModeOptionSchema,
	format: Type.Optional(outputFormatSchema),
	...sessionOptionSchema,
	stealth: Type.Optional(Type.Unsafe<boolean>({})),
	autoWait: Type.Optional(Type.Unsafe<boolean>({})),
	browserBackend: Type.Optional(
		Type.Unsafe<"cloak" | "playwright">({
			description: "cloak|playwright",
		}),
	),
} as const;

export function urlProperty(): ReturnType<typeof Type.Unsafe<string>> {
	return Type.Unsafe<string>({});
}
