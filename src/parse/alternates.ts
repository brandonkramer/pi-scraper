import * as cheerio from "cheerio";
import { absoluteUrl } from "./selectors.js";

export interface AlternateLink {
  url: string;
  rel: string;
  type?: string;
  title?: string;
  isAgentReadable: boolean;
}

const AGENT_TYPES = new Set(["text/markdown", "text/plain", "application/json", "application/ld+json"]);

export function discoverAlternateLinks(html: string, baseUrl: string): AlternateLink[] {
  const $ = cheerio.load(html);
  const links: AlternateLink[] = [];
  $('link[href],a[href][rel~="alternate"]').each((_, node) => {
    const element = $(node);
    const rel = element.attr("rel") ?? "";
    if (!rel.includes("alternate") && node.tagName === "link") return;
    const url = absoluteUrl(element.attr("href"), baseUrl);
    if (!url) return;
    const type = element.attr("type");
    links.push({ url, rel, type, title: element.attr("title"), isAgentReadable: isAgentReadableAlternate(url, type) });
  });
  return links;
}

export function isAgentReadableAlternate(url: string, type?: string): boolean {
  const lower = url.toLowerCase();
  return type !== undefined && AGENT_TYPES.has(type.toLowerCase()) ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".txt") ||
    lower.includes("llms.txt");
}
