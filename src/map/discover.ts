/**
 * @fileoverview map discover module.
 */
import type { HttpClient } from "../http/client.ts";
import { createHttpClient } from "../http/client.ts";
import { normalizeUrl } from "../url/normalize.ts";
import { llmsUrlForSite, parseLlmsLinks } from "./llms.ts";
import { parseRobotsSitemaps, robotsUrlForSite } from "./robots.ts";
import { defaultSitemapUrl, parseSitemapXml } from "./sitemaps.ts";

export interface MapUrlEntry {
  url: string;
  source: "robots" | "sitemap" | "llms";
  sourceUrl: string;
  lastmod?: string;
  title?: string;
}

export interface SiteMapResult {
  seedUrl: string;
  urls: MapUrlEntry[];
  tree: Record<string, string[]>;
  sitemaps: string[];
}

export interface SiteMapOptions {
  maxSitemaps?: number;
  cacheTtlSeconds?: number;
  maxAgeSeconds?: number;
  refresh?: boolean;
}

export interface SiteMapDeps {
  httpClient?: Pick<HttpClient, "fetchUrl">;
}

export async function discoverSiteUrls(seed: string, options: SiteMapOptions = {}, deps: SiteMapDeps = {}, signal?: AbortSignal): Promise<SiteMapResult> {
  const seedUrl = normalizeUrl(seed);
  const client = deps.httpClient ?? createHttpClient();
  const found = new Map<string, MapUrlEntry>();
  const sitemaps = new Set<string>();

  const robotsUrl = robotsUrlForSite(seedUrl);
  const robots = await fetchText(client, robotsUrl, options, signal);
  if (robots) for (const sitemap of parseRobotsSitemaps(robots, robotsUrl).sitemaps) sitemaps.add(sitemap);
  sitemaps.add(defaultSitemapUrl(seedUrl));

  const queue = [...sitemaps];
  const maxSitemaps = options.maxSitemaps ?? 20;
  for (let index = 0; index < queue.length && index < maxSitemaps; index += 1) {
    const sitemapUrl = queue[index]!;
    const body = await fetchSitemap(client, sitemapUrl, options, signal);
    if (!body) continue;
    const parsed = parseSitemapXml(body, sitemapUrl);
    for (const nested of parsed.sitemaps) if (!sitemaps.has(nested)) { sitemaps.add(nested); queue.push(nested); }
    for (const entry of parsed.urls) found.set(entry.url, { url: entry.url, source: "sitemap", sourceUrl: entry.source, lastmod: entry.lastmod });
  }

  const llmsUrl = llmsUrlForSite(seedUrl);
  const llms = await fetchText(client, llmsUrl, options, signal);
  if (llms) for (const entry of parseLlmsLinks(llms, llmsUrl)) found.set(entry.url, { url: entry.url, source: "llms", sourceUrl: entry.source, title: entry.title });

  return { seedUrl, urls: [...found.values()].sort((a, b) => a.url.localeCompare(b.url)), tree: buildTree([...found.keys()]), sitemaps: [...sitemaps] };
}

function buildTree(urls: string[]): Record<string, string[]> {
  const tree: Record<string, string[]> = {};
  for (const url of urls) {
    const parsed = new URL(url);
    const section = parsed.pathname.split("/").filter(Boolean)[0] ?? "/";
    tree[section] = [...(tree[section] ?? []), url];
  }
  return tree;
}

async function fetchText(client: Pick<HttpClient, "fetchUrl">, url: string, options: SiteMapOptions, signal?: AbortSignal): Promise<string | undefined> {
  const result = await client.fetchUrl(url, { respectRobots: false, forceText: true, maxBytes: 2 * 1024 * 1024, cacheTtlSeconds: options.cacheTtlSeconds, maxAgeSeconds: options.maxAgeSeconds, refresh: options.refresh }, signal).catch(() => undefined);
  return result?.text;
}

async function fetchSitemap(client: Pick<HttpClient, "fetchUrl">, url: string, options: SiteMapOptions, signal?: AbortSignal): Promise<string | Buffer | undefined> {
  const result = await client.fetchUrl(url, { respectRobots: false, forceText: true, maxBytes: 2 * 1024 * 1024, cacheTtlSeconds: options.cacheTtlSeconds, maxAgeSeconds: options.maxAgeSeconds, refresh: options.refresh }, signal).catch(() => undefined);
  if (!result) return undefined;
  if (url.endsWith(".gz") && result.body) return result.body;
  return result.text ?? result.body;
}
