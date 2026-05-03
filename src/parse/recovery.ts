import type { CheerioAPI } from "cheerio";
import { absoluteUrl } from "./selectors.js";

export interface RecoveredContent {
  kind: "heading" | "hero" | "announcement" | "footer_link";
  text: string;
  url?: string;
}

export function recoverUsefulContent($: CheerioAPI, baseUrl: string): RecoveredContent[] {
  const recovered: RecoveredContent[] = [];
  $("h1,h2,[class*=hero],[id*=hero],[class*=announcement],[role=banner]").each((_, node) => {
    const text = clean($(node).text());
    if (!text) return;
    const kind = node.tagName.match(/^h[12]$/iu) ? "heading" : text.toLowerCase().includes("announce") ? "announcement" : "hero";
    recovered.push({ kind, text });
  });
  $("footer a[href],nav[aria-label*=footer i] a[href]").each((_, node) => {
    const element = $(node);
    const text = clean(element.text());
    const url = absoluteUrl(element.attr("href"), baseUrl);
    if (text && url) recovered.push({ kind: "footer_link", text, url });
  });
  return dedupe(recovered);
}

function dedupe(items: RecoveredContent[]): RecoveredContent[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.text}:${item.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
