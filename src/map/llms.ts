/**
 * @fileoverview map llms module.
 */
import { normalizeUrl } from "../url/normalize.js";

export interface LlmsLinkEntry {
  url: string;
  title?: string;
  source: string;
}

export function llmsUrlForSite(seedUrl: string): string {
  const parsed = new URL(seedUrl);
  return `${parsed.protocol}//${parsed.host}/llms.txt`;
}

export function parseLlmsLinks(markdown: string, llmsUrl: string): LlmsLinkEntry[] {
  const base = new URL(llmsUrl);
  const links: LlmsLinkEntry[] = [];
  for (const match of markdown.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    links.push({ title: match[1], url: normalizeUrl(new URL(match[2]!, base).toString()), source: llmsUrl });
  }
  for (const match of markdown.matchAll(/(^|\s)(https?:\/\/[^\s)]+)/giu)) {
    links.push({ url: normalizeUrl(match[2]!), source: llmsUrl });
  }
  return dedupe(links);
}

function dedupe(entries: LlmsLinkEntry[]): LlmsLinkEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
