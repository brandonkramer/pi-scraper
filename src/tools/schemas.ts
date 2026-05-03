import { StringEnum, Type } from "@mariozechner/pi-ai";
import { OUTPUT_FORMATS, SCRAPE_MODES } from "../defaults.js";

export const scrapeModeSchema = StringEnum(SCRAPE_MODES, { description: "Scrape mode. Use auto unless the user requested a specific path." });
export const outputFormatSchema = StringEnum(OUTPUT_FORMATS, { description: "Output format for extracted content." });

export const headersSchema = Type.Record(Type.String(), Type.String(), { description: "Optional HTTP headers." });

export const commonRequestSchema = {
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })),
  maxBytes: Type.Optional(Type.Number({ minimum: 1024 })),
  maxChars: Type.Optional(Type.Number({ minimum: 1000 })),
  headers: Type.Optional(headersSchema),
  proxy: Type.Optional(Type.String({ description: "Optional proxy URL for supported modes/providers." })),
  respectRobots: Type.Optional(Type.Boolean({ description: "Respect robots.txt; defaults to true." })),
} as const;

export const scrapeOptionSchema = {
  mode: Type.Optional(scrapeModeSchema),
  format: Type.Optional(outputFormatSchema),
  include: Type.Optional(Type.Array(Type.String())),
  exclude: Type.Optional(Type.Array(Type.String())),
  onlyMainContent: Type.Optional(Type.Boolean()),
  removeImages: Type.Optional(Type.Boolean()),
  browserProfile: Type.Optional(Type.String()),
  osProfile: Type.Optional(Type.String()),
  ...commonRequestSchema,
} as const;

export function urlProperty(description = "HTTP(S) URL"): ReturnType<typeof Type.String> {
  return Type.String({ description });
}
