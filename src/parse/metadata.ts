import type { CheerioAPI } from "cheerio";
import { absoluteUrl } from "./selectors.js";

export interface PageMetadata {
  title?: string;
  description?: string;
  language?: string;
  canonicalUrl?: string;
  meta: Record<string, string>;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
}

export interface PageHeading {
  level: number;
  text: string;
}

export interface PageLink {
  url: string;
  text: string;
  rel?: string;
}

export function extractMetadata($: CheerioAPI, baseUrl: string): PageMetadata {
  const meta: Record<string, string> = {};
  const openGraph: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  $("meta").each((_, node) => {
    const element = $(node);
    const key = element.attr("name") ?? element.attr("property") ?? element.attr("http-equiv");
    const content = element.attr("content");
    if (!key || !content) return;
    meta[key] = content;
    if (key.startsWith("og:")) openGraph[key.slice(3)] = content;
    if (key.startsWith("twitter:")) twitter[key.slice(8)] = content;
  });
  return {
    title: clean($("head > title").first().text()) || meta.title || openGraph.title,
    description: meta.description ?? openGraph.description ?? twitter.description,
    language: $("html").attr("lang"),
    canonicalUrl: absoluteUrl($('link[rel~="canonical"]').first().attr("href"), baseUrl),
    meta,
    openGraph,
    twitter,
  };
}

export function extractHeadings($: CheerioAPI): PageHeading[] {
  const headings: PageHeading[] = [];
  $("h1,h2,h3,h4,h5,h6").each((_, node) => {
    const level = Number.parseInt(node.tagName.slice(1), 10);
    const text = clean($(node).text());
    if (text) headings.push({ level, text });
  });
  return headings;
}

export function extractLinks($: CheerioAPI, baseUrl: string): PageLink[] {
  const links: PageLink[] = [];
  $("a[href]").each((_, node) => {
    const element = $(node);
    const url = absoluteUrl(element.attr("href"), baseUrl);
    if (!url) return;
    links.push({ url, text: clean(element.text()), rel: element.attr("rel") });
  });
  return links;
}

function clean(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
