import type { CheerioAPI } from "cheerio";
import { absoluteUrl } from "../parse/selectors.js";

export interface BrandAsset {
  url: string;
  kind: "logo" | "icon" | "image" | "manifest";
  rel?: string;
  alt?: string;
  type?: string;
  source: string;
}

export function extractBrandAssets($: CheerioAPI, baseUrl: string): BrandAsset[] {
  const assets: BrandAsset[] = [];
  $("link[href]").each((_, node) => {
    const element = $(node);
    const rel = element.attr("rel")?.toLowerCase() ?? "";
    const href = absoluteUrl(element.attr("href"), baseUrl);
    if (!href) return;
    if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
      assets.push({ url: href, kind: "icon", rel, type: element.attr("type"), source: "link" });
    } else if (rel.includes("manifest")) {
      assets.push({ url: href, kind: "manifest", rel, type: element.attr("type"), source: "link" });
    }
  });

  $('meta[property="og:image"],meta[name="twitter:image"]').each((_, node) => {
    const element = $(node);
    const url = absoluteUrl(element.attr("content"), baseUrl);
    if (url) assets.push({ url, kind: "image", source: element.attr("property") ?? element.attr("name") ?? "meta" });
  });

  $("img[src]").each((_, node) => {
    const element = $(node);
    const src = element.attr("src") ?? "";
    const alt = element.attr("alt") ?? "";
    const className = element.attr("class") ?? "";
    const id = element.attr("id") ?? "";
    if (!/logo|brand|mark/iu.test(`${src} ${alt} ${className} ${id}`)) return;
    const url = absoluteUrl(src, baseUrl);
    if (url) assets.push({ url, kind: "logo", alt, source: "img" });
  });
  return dedupeAssets(assets);
}

function dedupeAssets(assets: BrandAsset[]): BrandAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.kind}:${asset.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
