import { describe, expect, it } from "vitest";
import { listExtractorCapabilities, runVerticalExtractor } from "../registry.js";
import type { VerticalExtractorContext } from "../capabilities.js";

const context: VerticalExtractorContext = {
  fetchJson: async <T>(url: string) => {
    if (url.includes("api.github.com")) {
      return { full_name: "mario/pi", html_url: "https://github.com/mario/pi", stargazers_count: 42, forks_count: 3, open_issues_count: 2, default_branch: "main", owner: { login: "mario" }, license: { spdx_id: "MIT" } } as T;
    }
    if (url.includes("registry.npmjs.org")) {
      return { name: "pi-scraper", description: "scrape", "dist-tags": { latest: "1.2.3" }, versions: { "1.2.3": { license: "MIT" } } } as T;
    }
    if (url.includes("pypi.org")) {
      return { info: { name: "requests", version: "2.0.0", summary: "HTTP", project_urls: { Source: "https://example.com" } } } as T;
    }
    return { id: 123, type: "story", title: "HN", url: "https://example.com", score: 10 } as T;
  },
};

describe("vertical extractor registry", () => {
  it("lists capability declarations for deterministic extractors", () => {
    const names = listExtractorCapabilities().map((capability) => capability.name);
    expect(names).toEqual(expect.arrayContaining(["github_repo", "npm", "pypi", "hackernews"]));
    expect(listExtractorCapabilities()[0]).toMatchObject({ requiresBrowser: false, requiresLLM: false, requiresCloud: false });
  });

  it("runs named API-oriented extractors", async () => {
    const github = await runVerticalExtractor("github_repo", "https://github.com/mario/pi", { context });
    expect(github.data).toMatchObject({ fullName: "mario/pi", stars: 42, license: "MIT" });

    const npm = await runVerticalExtractor("npm", "https://www.npmjs.com/package/pi-scraper", { context });
    expect(npm.data).toMatchObject({ name: "pi-scraper", latestVersion: "1.2.3" });
  });

  it("returns structured unsupported errors", async () => {
    await expect(runVerticalExtractor("missing", "https://example.com", { context })).resolves.toMatchObject({ error: { code: "EXTRACTOR_NOT_FOUND" } });
    await expect(runVerticalExtractor("github_repo", "https://example.com", { context })).resolves.toMatchObject({ error: { code: "URL_NOT_SUPPORTED" } });
  });
});
