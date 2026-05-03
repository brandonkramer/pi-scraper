import { capability, type VerticalExtractor } from "../capabilities.js";

interface NpmRegistryPackage {
  name: string;
  description?: string;
  "dist-tags"?: { latest?: string };
  versions?: Record<string, { license?: string; repository?: unknown }>;
  homepage?: string;
}

export const npmPackageExtractor: VerticalExtractor = {
  capability: capability("npm", ["https://www.npmjs.com/package/:name", "https://npmjs.com/package/:name"], {
    type: "object",
    required: ["name", "latestVersion"],
    properties: { name: { type: "string" }, latestVersion: { type: "string" } },
  }),
  match: (url) => {
    if (url.hostname !== "www.npmjs.com" && url.hostname !== "npmjs.com") return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "package") return undefined;
    const name = parts[1]?.startsWith("@") ? `${parts[1]}/${parts[2] ?? ""}` : parts[1];
    return name ? { name } : undefined;
  },
  extract: async (_url, match, context, signal) => {
    const pkg = await context.fetchJson<NpmRegistryPackage>(`https://registry.npmjs.org/${encodeURIComponent(match.name).replace(/%2F/gu, "/")}`, signal);
    const latest = pkg["dist-tags"]?.latest;
    return {
      name: pkg.name,
      description: pkg.description,
      latestVersion: latest,
      homepage: pkg.homepage,
      license: latest ? pkg.versions?.[latest]?.license : undefined,
    };
  },
};
