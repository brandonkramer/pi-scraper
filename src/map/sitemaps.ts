/**
 * @fileoverview map sitemaps module.
 */
import { gunzipSync } from "node:zlib";
import { normalizeUrl } from "../url/normalize.js";

export interface SitemapUrlEntry {
  url: string;
  lastmod?: string;
  source: string;
}

export interface SitemapParseResult {
  urls: SitemapUrlEntry[];
  sitemaps: string[];
}

export function parseSitemapXml(xml: string | Buffer, source: string): SitemapParseResult {
  const text = Buffer.isBuffer(xml) ? decodeMaybeGzip(xml, source) : xml;
  const urls = [...text.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/giu)].map((match) => {
    const block = match[1] ?? "";
    const loc = tagText(block, "loc");
    return loc ? { url: normalizeUrl(loc), lastmod: tagText(block, "lastmod"), source } : undefined;
  }).filter(Boolean) as SitemapUrlEntry[];
  const sitemaps = [...text.matchAll(/<sitemap>\s*([\s\S]*?)\s*<\/sitemap>/giu)]
    .map((match) => tagText(match[1] ?? "", "loc"))
    .filter(Boolean)
    .map((loc) => normalizeUrl(loc!));
  return { urls, sitemaps };
}

export function defaultSitemapUrl(seedUrl: string): string {
  const parsed = new URL(seedUrl);
  return `${parsed.protocol}//${parsed.host}/sitemap.xml`;
}

function tagText(block: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "iu"));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/u, "$1").trim();
}

function decodeMaybeGzip(buffer: Buffer, source: string): string {
  return source.endsWith(".gz") ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
}
