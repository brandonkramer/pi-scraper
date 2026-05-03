import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { normalizeWhitespace } from "../serialize/text.js";

export interface ReadableExtraction {
  ok: boolean;
  reason?: "unavailable" | "unsuitable" | "failed";
  title?: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
  textContent?: string;
  contentHtml?: string;
  length?: number;
}

export function extractReadable(html: string, _url: string): ReadableExtraction {
  try {
    const { document } = parseHTML(html);
    const fallbackTitle = document.querySelector("h1")?.textContent?.trim() || document.querySelector("title")?.textContent?.trim();
    const clone = document.cloneNode(true) as Document;
    if (!isProbablyReaderable(clone)) {
      return { ok: false, reason: "unsuitable" };
    }
    const article = new Readability(clone).parse();
    if (!article?.textContent) {
      return { ok: false, reason: "failed" };
    }
    return {
      ok: true,
      title: article.title || fallbackTitle || undefined,
      excerpt: article.excerpt ?? undefined,
      byline: article.byline ?? undefined,
      siteName: article.siteName ?? undefined,
      textContent: normalizeWhitespace(article.textContent),
      contentHtml: article.content ?? undefined,
      length: article.length ?? undefined,
    };
  } catch (error) {
    return { ok: false, reason: "failed", excerpt: error instanceof Error ? error.message : undefined };
  }
}
