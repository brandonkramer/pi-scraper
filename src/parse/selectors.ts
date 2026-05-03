import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { normalizeWhitespace } from "../serialize/text.js";

export interface SelectorOptions {
  include?: string[];
  exclude?: string[];
  removeImages?: boolean;
}

const DEFAULT_REMOVE = "script,style,noscript,template,iframe,canvas";

export function prepareDocument($: CheerioAPI, options: SelectorOptions = {}): void {
  $(DEFAULT_REMOVE).remove();
  if (options.removeImages) $("img,picture,source").remove();
  for (const selector of options.exclude ?? []) $(selector).remove();
}

export function selectedRoots($: CheerioAPI, options: SelectorOptions = {}): Cheerio<AnyNode> {
  const include = options.include?.filter(Boolean) ?? [];
  if (include.length === 0) return $("body").length ? $("body") : $.root();
  const roots = include.map((selector) => $(selector).toArray()).flat();
  return $(dedupeElements(roots));
}

export function visibleText($: CheerioAPI, root: Cheerio<AnyNode> = $("body")): string {
  return normalizeWhitespace(root.text());
}

export function outerHtml($: CheerioAPI, root: Cheerio<AnyNode>): string {
  return root.toArray().map((node) => $.html(node)).join("\n");
}

export function absoluteUrl(href: string | undefined, baseUrl: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function dedupeElements(elements: AnyNode[]): AnyNode[] {
  return [...new Set(elements)];
}
