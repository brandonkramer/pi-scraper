/** @file Vertical manifest tests. */
import { describe, expect, it } from "vitest";

import { matchUrlPattern, extractJsonPath } from "../../vertical/extractor.ts";
import { parseJsonc, parseManifestText, parseYamlManifest } from "../../vertical/loader.ts";
import { mergeManifests } from "../../vertical/manifest-registry.ts";
import type { VerticalManifest } from "../../vertical/manifest-types.ts";
import { isManifestValid, validateManifest } from "../../vertical/validate.ts";

describe("vertical manifest", () => {
	describe("parseYamlManifest", () => {
		it("parses human-authored YAML recipes", () => {
			const result = parseYamlManifest(`
name: test
kind: recipe
urlPatterns:
  - https://example.com/:id
recipe:
  primitive: http.jsonResource
  request:
    urlTemplate: https://api.example.com/{{id}}
`);
			expect(result).toEqual({
				name: "test",
				kind: "recipe",
				urlPatterns: ["https://example.com/:id"],
				recipe: {
					primitive: "http.jsonResource",
					request: { urlTemplate: "https://api.example.com/{{id}}" },
				},
			});
		});

		it("dispatches .yaml files through the YAML parser", () => {
			const result = parseManifestText("name: test\nkind: api-json\n", "test.yaml");
			expect(result).toEqual({ name: "test", kind: "api-json" });
		});
	});

	describe("parseJsonc", () => {
		it("parses JSON with line comments", () => {
			const result = parseJsonc(`{
        // this is a comment
        "name": "test",
        "kind": "api-json"
      }`);
			expect(result).toEqual({ name: "test", kind: "api-json" });
		});

		it("parses JSON with block comments", () => {
			const result = parseJsonc(`{
        /* block comment */
        "name": "test",
        "kind": "api-json"
      }`);
			expect(result).toEqual({ name: "test", kind: "api-json" });
		});

		it("preserves URLs with // in strings", () => {
			const result = parseJsonc(`{
        "url": "https://example.com/path",
        "pattern": "https://example.com/:id"
      }`);
			expect(result).toEqual({
				url: "https://example.com/path",
				pattern: "https://example.com/:id",
			});
		});

		it("strips trailing commas", () => {
			const result = parseJsonc(`{
        "name": "x",
        "items": [1, 2,],
      }`);
			expect(result).toEqual({ name: "x", items: [1, 2] });
		});
	});

	describe("validateManifest", () => {
		it("accepts a valid api-json manifest", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "test_api",
					kind: "api-json",
					version: 1,
					description: "Test API vertical",
					urlPatterns: ["https://example.com/:id"],
					request: {
						method: "GET",
						urlTemplate: "https://api.example.com/{{id}}",
						headers: { accept: "application/json" },
					},
					extract: { id: "$.id", name: "$.name" },
				},
				"user",
				"/tmp/test.jsonc",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics).toHaveLength(0);
			expect(manifest.name).toBe("test_api");
			expect(manifest.source).toBe("user");
		});

		it("rejects invalid names", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "123bad",
					kind: "api-json",
					version: 1,
					description: "x",
					urlPatterns: ["https://example.com/:id"],
					request: { urlTemplate: "https://api.example.com/{{id}}" },
					extract: { id: "$.id" },
				},
				"user",
			);
			expect(isManifestValid(manifest)).toBe(false);
			expect(diagnostics.some((d) => d.message.includes("name must start"))).toBe(true);
		});

		it("rejects private-network patterns", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "bad",
					kind: "api-json",
					version: 1,
					description: "x",
					urlPatterns: ["https://localhost/api"],
					request: { urlTemplate: "https://localhost/api" },
					extract: { id: "$.id" },
				},
				"user",
			);
			expect(isManifestValid(manifest)).toBe(false);
			expect(diagnostics.some((d) => d.message.includes("private-network"))).toBe(true);
		});

		it("rejects metadata IP 169.254.169.254", () => {
			const { diagnostics } = validateManifest(
				{
					name: "test",
					kind: "api-json",
					version: 1,
					description: "x",
					urlPatterns: [],
					request: { urlTemplate: "http://169.254.169.254/latest/meta-data/" },
					extract: { id: "$.id" },
				},
				"user",
			);
			expect(diagnostics.some((d) => d.message.includes("169.254.169.254"))).toBe(true);
		});

		it("rejects 0.0.0.0 patterns", () => {
			const { diagnostics } = validateManifest(
				{
					name: "test",
					kind: "api-json",
					version: 1,
					description: "x",
					urlPatterns: ["http://0.0.0.0:8080/api"],
				},
				"user",
			);
			expect(diagnostics.some((d) => d.message.includes("0.0.0.0"))).toBe(true);
		});

		it("rejects [::1] ipv6 loopback", () => {
			const { diagnostics } = validateManifest(
				{
					name: "test",
					kind: "api-json",
					version: 1,
					description: "x",
					urlPatterns: ["http://[::1]:8080/api"],
				},
				"user",
			);
			expect(diagnostics.some((d) => d.message.includes("::1"))).toBe(true);
		});

		it("rejects templated host in request.urlTemplate", () => {
			const { diagnostics } = validateManifest(
				{
					name: "test",
					kind: "api-json",
					version: 1,
					description: "x",
					urlPatterns: ["https://example.com/:id"],
					request: { urlTemplate: "http://{{host}}/api" },
				},
				"user",
			);
			expect(diagnostics.some((d) => d.message.includes("templated host"))).toBe(true);
		});

		it("accepts Wikipedia language-templated hosts in request.urlTemplate", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "wikipedia",
					kind: "api-json-aggregate",
					version: 1,
					description: "Wikipedia article extraction",
					urlPatterns: ["https://:lang.wikipedia.org/wiki/:title"],
					requests: {
						summary: {
							urlTemplate:
								"https://{{lang}}.wikipedia.org/api/rest_v1/page/summary/{{title|encodeURIComponent}}",
						},
					},
					extract: { title: "@.summary.title" },
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics.some((d) => d.message.includes("templated host"))).toBe(false);
		});

		it("rejects credential-like headers", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "bad",
					kind: "api-json",
					version: 1,
					description: "x",
					urlPatterns: ["https://example.com/:id"],
					request: {
						urlTemplate: "https://api.example.com/{{id}}",
						headers: { "x-api-key": "secret" },
					},
					extract: { id: "$.id" },
				},
				"user",
			);
			expect(isManifestValid(manifest)).toBe(false);
			expect(diagnostics.some((d) => d.message.includes("credential-like"))).toBe(true);
		});

		it("rejects private-network recipe step URLs", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "bad_recipe",
					kind: "recipe",
					version: 1,
					description: "x",
					urlPatterns: ["https://example.com/:id"],
					recipe: {
						primitive: "http.jsonChain",
						steps: [{ request: { urlTemplate: "http://127.0.0.1/api" } }],
					},
				},
				"user",
			);
			expect(isManifestValid(manifest)).toBe(false);
			expect(diagnostics.some((d) => d.field === "recipe.steps[0].request.urlTemplate")).toBe(true);
		});

		it("rejects missing required fields", () => {
			const { manifest, diagnostics } = validateManifest({}, "user");
			expect(isManifestValid(manifest)).toBe(false);
			expect(diagnostics.some((d) => d.message.includes("missing required field: name"))).toBe(
				true,
			);
			expect(
				diagnostics.some((d) => d.message.includes("missing required field: description")),
			).toBe(true);
		});

		it("accepts html-extract manifests with top-level fields", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "docsite",
					kind: "html-extract",
					version: 1,
					description: "Docs",
					urlPatterns: ["https://example.com/:path*"],
					fields: { title: { selectorText: ["h1"] } },
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
		});

		it("accepts text-extract manifests with request and fields", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "deepwiki",
					kind: "text-extract",
					version: 1,
					description: "Wiki",
					urlPatterns: ["https://deepwiki.com/:owner/:repo"],
					request: { urlTemplate: "https://deepwiki.com/{{owner}}/{{repo}}" },
					fields: { owner: { value: "{{owner}}" } },
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
		});

		it("accepts api-json-aggregate manifests with requests and extract", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "github_repo",
					kind: "api-json-aggregate",
					version: 1,
					description: "GitHub repo",
					urlPatterns: ["https://github.com/:owner/:repo"],
					requests: {
						metadata: { urlTemplate: "https://api.github.com/repos/{{owner}}/{{repo}}" },
					},
					extract: { fullName: "@.metadata.full_name" },
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
		});

		it("accepts api-json-chain manifests with steps and extract", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "ossinsight_collection_ranking",
					kind: "api-json-chain",
					version: 1,
					description: "Ranking",
					urlPatterns: ["https://ossinsight.io/collections/:slug"],
					steps: [
						{ request: { urlTemplate: "https://api.ossinsight.io/v1/collections/" }, as: "rows" },
					],
					extract: { metric: "{{metric}}" },
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
		});

		it("accepts http-workflow manifests with steps", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "reddit",
					kind: "http-workflow",
					version: 1,
					description: "Reddit",
					urlPatterns: ["https://reddit.com/r/:subreddit/comments/:postId"],
					steps: [{ tryJson: { as: "data", endpoints: [{ url: "https://reddit.com/x.json" }] } }],
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
		});

		it("accepts code-extract manifests with languages", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "docstrings",
					kind: "code-extract",
					version: 1,
					description: "Docstrings",
					urlPatterns: ["https://example.com/:path*.ts"],
					languages: ["typescript"],
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
		});

		it("rejects html-extract manifests without fields", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "bad_html",
					kind: "html-extract",
					version: 1,
					description: "x",
					urlPatterns: ["https://example.com/:id"],
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(false);
			expect(diagnostics.some((d) => d.field === "fields")).toBe(true);
		});

		it("rejects unknown kinds", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "bad",
					kind: "unknown",
					version: 1,
					description: "x",
					urlPatterns: ["https://example.com/:id"],
				},
				"user",
			);
			expect(isManifestValid(manifest)).toBe(false);
			expect(diagnostics.some((d) => d.message.includes("unknown kind"))).toBe(true);
		});

		it("accepts a valid builtin manifest", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "github_repo",
					kind: "builtin",
					version: 1,
					handler: "builtin.github_repo",
					description: "GitHub repo metadata",
					urlPatterns: ["https://github.com/:owner/:repo"],
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(true);
			expect(diagnostics).toHaveLength(0);
		});

		it("rejects builtin without handler prefix", () => {
			const { manifest, diagnostics } = validateManifest(
				{
					name: "github_repo",
					kind: "builtin",
					version: 1,
					handler: "github_repo",
					description: "GitHub repo metadata",
					urlPatterns: ["https://github.com/:owner/:repo"],
				},
				"builtin",
			);
			expect(isManifestValid(manifest)).toBe(false);
			expect(diagnostics.some((d) => d.message.includes("builtin."))).toBe(true);
		});
	});

	describe("mergeManifests", () => {
		it("merges built-in and user manifests", () => {
			const builtins: VerticalManifest[] = [
				{
					version: 1,
					name: "github_repo",
					kind: "builtin",
					handler: "builtin.github_repo",
					description: "GitHub",
					urlPatterns: ["https://github.com/:owner/:repo"],
					source: "builtin",
				},
			];
			const users: VerticalManifest[] = [
				{
					version: 1,
					name: "my_api",
					kind: "api-json",
					description: "My API",
					urlPatterns: ["https://api.example.com/:id"],
					request: { urlTemplate: "https://api.example.com/{{id}}" },
					extract: { id: "$.id" },
					source: "user",
				},
			];
			const registry = mergeManifests(builtins, users, []);
			expect(registry.entries).toHaveLength(2);
			expect(registry.get("github_repo")).toBeDefined();
			expect(registry.get("my_api")).toBeDefined();
			expect(registry.get("my_api")?.isDeclarative).toBe(true);
		});

		it("lets user manifests override package manifests by priority", () => {
			const packageManifests: VerticalManifest[] = [
				{
					version: 1,
					name: "github_repo",
					kind: "builtin",
					handler: "builtin.github_repo",
					description: "GitHub",
					urlPatterns: ["https://github.com/:owner/:repo"],
					source: "builtin",
				},
			];
			const users: VerticalManifest[] = [
				{
					version: 1,
					name: "github_repo",
					kind: "api-json",
					description: "Override",
					urlPatterns: ["https://github.com/:owner/:repo"],
					request: { urlTemplate: "https://api.example.com/{{id}}" },
					extract: { id: "$.id" },
					source: "user",
				},
			];
			const registry = mergeManifests(packageManifests, users, []);
			expect(registry.entries).toHaveLength(1);
			expect(registry.get("github_repo")?.activeSource).toBe("user");
			expect(registry.get("github_repo")?.isDeclarative).toBe(true);
			expect(registry.get("github_repo")?.overridden).toBe(true);
			expect(registry.errors).toHaveLength(0);
		});

		it("lets project manifests override global user manifests by priority", () => {
			const packageManifests: VerticalManifest[] = [
				{
					version: 1,
					name: "internal_api",
					kind: "builtin",
					handler: "builtin.internal_api",
					description: "Package",
					urlPatterns: ["https://example.com/:id"],
					source: "builtin",
				},
			];
			const overlays: VerticalManifest[] = [
				{
					version: 1,
					name: "internal_api",
					kind: "api-json",
					description: "Global",
					urlPatterns: ["https://example.com/:id"],
					request: { urlTemplate: "https://api.example.com/global/{{id}}" },
					extract: { id: "$.id" },
					source: "user",
				},
				{
					version: 1,
					name: "internal_api",
					kind: "api-json",
					description: "Project",
					urlPatterns: ["https://example.com/:id"],
					request: { urlTemplate: "https://api.example.com/project/{{id}}" },
					extract: { id: "$.id" },
					source: "project",
				},
			];
			const registry = mergeManifests(packageManifests, overlays, []);
			expect(registry.entries).toHaveLength(1);
			expect(registry.get("internal_api")?.activeSource).toBe("project");
			expect(registry.get("internal_api")?.manifest.description).toBe("Project");
			expect(registry.get("internal_api")?.overridden).toBe(true);
		});

		it("allows override with flag", () => {
			const builtins: VerticalManifest[] = [
				{
					version: 1,
					name: "github_repo",
					kind: "builtin",
					handler: "builtin.github_repo",
					description: "GitHub",
					urlPatterns: ["https://github.com/:owner/:repo"],
					source: "builtin",
				},
			];
			const users: VerticalManifest[] = [
				{
					version: 1,
					name: "github_repo",
					kind: "api-json",
					description: "Override",
					urlPatterns: ["https://github.com/:owner/:repo"],
					request: { urlTemplate: "https://api.example.com/{{id}}" },
					extract: { id: "$.id" },
					source: "user",
					override: true,
				},
			];
			const registry = mergeManifests(builtins, users, []);
			expect(registry.entries).toHaveLength(1);
			expect(registry.get("github_repo")?.isDeclarative).toBe(true);
			expect(registry.get("github_repo")?.overridden).toBe(true);
		});

		it("matches URLs against merged manifests", () => {
			const builtins: VerticalManifest[] = [
				{
					version: 1,
					name: "github_repo",
					kind: "builtin",
					handler: "builtin.github_repo",
					description: "GitHub",
					urlPatterns: ["https://github.com/:owner/:repo"],
					source: "builtin",
				},
			];
			const registry = mergeManifests(builtins, [], []);
			const match = registry.match(new URL("https://github.com/foo/bar"));
			expect(match).toBeDefined();
			expect(match?.entry.manifest.name).toBe("github_repo");
			expect(match?.captures).toEqual({ owner: "foo", repo: "bar" });
		});
	});

	describe("matchUrlPattern", () => {
		it("matches simple patterns", () => {
			const match = matchUrlPattern(new URL("https://github.com/foo/bar"), [
				"https://github.com/:owner/:repo",
			]);
			expect(match).toEqual({ owner: "foo", repo: "bar" });
		});

		it("returns undefined for non-matching host", () => {
			const match = matchUrlPattern(new URL("https://gitlab.com/foo/bar"), [
				"https://github.com/:owner/:repo",
			]);
			expect(match).toBeUndefined();
		});

		it("returns undefined for non-matching path", () => {
			const match = matchUrlPattern(new URL("https://github.com/foo"), [
				"https://github.com/:owner/:repo",
			]);
			expect(match).toBeUndefined();
		});

		it("captures query parameters", () => {
			const match = matchUrlPattern(new URL("https://example.com/item?id=42&foo=bar"), [
				"https://example.com/item",
			]);
			expect(match).toEqual({ id: "42", foo: "bar" });
		});

		it("captures language subdomains in host patterns", () => {
			const match = matchUrlPattern(
				new URL("https://de.wikipedia.org/wiki/Python_(Programmiersprache)"),
				["https://:lang.wikipedia.org/wiki/:title"],
			);
			expect(match).toEqual({
				lang: "de",
				title: "Python_(Programmiersprache)",
			});
		});
	});

	describe("extractJsonPath", () => {
		it("extracts root", () => {
			expect(extractJsonPath({ a: 1 }, "$")).toEqual({ a: 1 });
		});

		it("extracts nested paths", () => {
			expect(extractJsonPath({ a: { b: "value" } }, "$.a.b")).toBe("value");
		});

		it("returns undefined for missing paths", () => {
			expect(extractJsonPath({ a: {} }, "$.a.b")).toBeUndefined();
		});

		it("returns constant for non-jsonpath", () => {
			expect(extractJsonPath({}, "hello")).toBe("hello");
		});
	});
});
