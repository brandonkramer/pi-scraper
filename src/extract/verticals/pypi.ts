/**
 * @fileoverview extract verticals pypi module.
 */
import { capability, type VerticalExtractor } from "../capabilities.js";

interface PypiPackage {
  info: { name: string; version: string; summary?: string; home_page?: string; license?: string; project_urls?: Record<string, string> };
}

export const pypiPackageExtractor: VerticalExtractor = {
  capability: capability("pypi", ["https://pypi.org/project/:name"], {
    type: "object",
    required: ["name", "version"],
    properties: { name: { type: "string" }, version: { type: "string" } },
  }),
  match: (url) => {
    if (url.hostname !== "pypi.org") return undefined;
    const [project, name] = url.pathname.split("/").filter(Boolean);
    return project === "project" && name ? { name } : undefined;
  },
  extract: async (_url, match, context, signal) => {
    const pkg = await context.fetchJson<PypiPackage>(`https://pypi.org/pypi/${encodeURIComponent(match.name)}/json`, signal);
    return { name: pkg.info.name, version: pkg.info.version, summary: pkg.info.summary, homepage: pkg.info.home_page, license: pkg.info.license, projectUrls: pkg.info.project_urls };
  },
};
