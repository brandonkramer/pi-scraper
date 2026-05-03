import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { extractBrandAssets, type BrandAsset } from "./assets.js";
import { extractCssColors, extractCssFonts, mergeFrequencies, type FrequencyItem } from "./css.js";

export interface BrandIdentity {
  url: string;
  name?: string;
  description?: string;
  themeColors: string[];
  colors: FrequencyItem[];
  fonts: FrequencyItem[];
  assets: BrandAsset[];
  manifest?: BrandManifest;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  schema: BrandSchemaEntity[];
  metadata: Record<string, string>;
}

export interface BrandExtractOptions {
  manifestJson?: string;
}

export interface BrandManifest {
  name?: string;
  shortName?: string;
  themeColor?: string;
  backgroundColor?: string;
  icons: BrandAsset[];
}

export interface BrandSchemaEntity {
  type?: string | string[];
  name?: string;
  url?: string;
  logo?: unknown;
  sameAs?: unknown;
}

export function extractBrandIdentity(html: string, url: string, options: BrandExtractOptions = {}): BrandIdentity {
  const $ = cheerio.load(html);
  const metadata = metaMap($);
  const openGraph = prefixed(metadata, "og:");
  const twitter = prefixed(metadata, "twitter:");
  const schema = extractSchemaEntities($);
  const manifest = parseManifest(options.manifestJson, url);
  const css = collectCss($);
  const inlineColors = extractCssColors($('[style]').map((_, node) => $(node).attr("style") ?? "").get().join(";"));
  const inlineFonts = extractCssFonts($('[style]').map((_, node) => $(node).attr("style") ?? "").get().join(";"));
  const themeColorValues = [...themeColors($), manifest?.themeColor, manifest?.backgroundColor].filter(Boolean) as string[];
  return {
    url,
    name: schema.find((item) => item.name)?.name ?? manifest?.name ?? manifest?.shortName ?? openGraph.site_name ?? openGraph.title ?? metadata["application-name"] ?? ($("title").first().text().trim() || undefined),
    description: metadata.description ?? openGraph.description ?? twitter.description,
    themeColors: themeColorValues,
    colors: mergeFrequencies(extractCssColors(css), inlineColors, extractCssColors(themeColorValues.join(" "))),
    fonts: mergeFrequencies(extractCssFonts(css), inlineFonts),
    assets: [...extractBrandAssets($, url), ...(manifest?.icons ?? [])],
    manifest,
    openGraph,
    twitter,
    schema,
    metadata,
  };
}

function metaMap($: CheerioAPI): Record<string, string> {
  const map: Record<string, string> = {};
  $("meta").each((_, node) => {
    const element = $(node);
    const key = element.attr("name") ?? element.attr("property") ?? element.attr("http-equiv");
    const content = element.attr("content");
    if (key && content) map[key] = content;
  });
  return map;
}

function prefixed(input: Record<string, string>, prefix: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith(prefix)) output[key.slice(prefix.length)] = value;
  }
  return output;
}

function themeColors($: CheerioAPI): string[] {
  return $('meta[name="theme-color"][content]').map((_, node) => $(node).attr("content")?.trim()).get().filter(Boolean);
}

function collectCss($: CheerioAPI): string {
  const styles = $("style").map((_, node) => $(node).text()).get();
  return styles.join("\n");
}

function extractSchemaEntities($: CheerioAPI): BrandSchemaEntity[] {
  const entities: BrandSchemaEntity[] = [];
  $('script[type="application/ld+json"]').each((_, node) => {
    const parsed = safeJson($(node).text());
    for (const item of flattenJsonLd(parsed)) {
      const type = item["@type"];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((entry) => entry === "Organization" || entry === "WebSite")) {
        entities.push({ type: schemaType(type), name: stringValue(item.name), url: stringValue(item.url), logo: item.logo, sameAs: item.sameAs });
      }
    }
  });
  return entities;
}

function flattenJsonLd(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  const record = value as Record<string, unknown>;
  const graph = record["@graph"];
  return [record, ...flattenJsonLd(graph)];
}

function parseManifest(text: string | undefined, baseUrl: string): BrandManifest | undefined {
  const manifest = safeJson(text ?? "") as Record<string, unknown> | undefined;
  if (!manifest) return undefined;
  return {
    name: stringValue(manifest.name),
    shortName: stringValue(manifest.short_name),
    themeColor: stringValue(manifest.theme_color),
    backgroundColor: stringValue(manifest.background_color),
    icons: Array.isArray(manifest.icons) ? manifest.icons.flatMap((icon) => manifestIcon(icon, baseUrl)) : [],
  };
}

function manifestIcon(value: unknown, baseUrl: string): BrandAsset[] {
  if (!value || typeof value !== "object") return [];
  const src = stringValue((value as Record<string, unknown>).src);
  if (!src) return [];
  try {
    return [{ url: new URL(src, baseUrl).toString(), kind: "icon", type: stringValue((value as Record<string, unknown>).type), source: "manifest" }];
  } catch {
    return [];
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function schemaType(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  return undefined;
}
