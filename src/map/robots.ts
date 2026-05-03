import { normalizeUrl } from "../url/normalize.js";

export interface RobotsMapInfo {
  robotsUrl: string;
  sitemaps: string[];
}

export function robotsUrlForSite(seedUrl: string): string {
  const parsed = new URL(seedUrl);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}

export function parseRobotsSitemaps(body: string, robotsUrl: string): RobotsMapInfo {
  const base = new URL(robotsUrl);
  const sitemaps = body.split(/\r?\n/u)
    .map((line) => line.match(/^\s*sitemap\s*:\s*(.+?)\s*$/iu)?.[1])
    .filter(Boolean)
    .map((value) => normalizeUrl(new URL(value!, base).toString()));
  return { robotsUrl, sitemaps: [...new Set(sitemaps)] };
}
