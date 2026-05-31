/** @file Declarative vertical extractor end-to-end tests. */
import { describe, expect, it } from "vitest";

import { createDeclarativeExtractor } from "../../vertical/manifest/declarative.ts";
import type { VerticalManifest } from "../../vertical/manifest/types.ts";

describe("declarative extractor", () => {
	const mockContext = {
		fetchJson: async <T>(url: string): Promise<T> => {
			if (url.includes("api.example.com")) {
				return {
					id: "42",
					name: "Test Item",
					summary: "This is a test item.",
					nested: { value: "deep" },
				} as T;
			}
			throw new Error(`Unexpected URL: ${url}`);
		},
		fetchText: async (url: string): Promise<string> => {
			if (url.includes("example.com")) {
				return "<html><title>Test</title><body>Hello World</body></html>";
			}
			throw new Error(`Unexpected URL: ${url}`);
		},
		fetchPage: async (url: string) => {
			if (url.includes("example.com")) {
				return {
					text: "<html><title>Test</title><body>Hello World</body></html>",
					finalUrl: url,
					status: 200,
					contentType: "text/html",
				};
			}
			throw new Error(`Unexpected URL: ${url}`);
		},
	};

	it("runs an api-json manifest", async () => {
		const manifest: VerticalManifest = {
			version: 1,
			name: "test_api",
			kind: "api-json",
			description: "Test API",
			urlPatterns: ["https://example.com/:id"],
			request: {
				method: "GET",
				urlTemplate: "https://api.example.com/{{match.id}}",
			},
			extract: {
				id: "$.id",
				name: "$.name",
				summary: "$.summary",
				nested: "$.nested.value",
			},
			limits: {
				summary: { maxChars: 10 },
			},
		};

		const extractor = createDeclarativeExtractor(manifest);
		const match = extractor.match(new URL("https://example.com/42"));
		expect(match).toEqual({ id: "42" });

		const result = await extractor.extract(new URL("https://example.com/42"), match!, mockContext);

		expect(result).toEqual({
			id: "42",
			name: "Test Item",
			summary: "This is a ",
			nested: "deep",
		});
	});

	it("runs a pattern manifest", async () => {
		const manifest: VerticalManifest = {
			version: 1,
			name: "test_pattern",
			kind: "pattern",
			description: "Test pattern",
			urlPatterns: ["https://example.com/page"],
			request: {
				urlTemplate: "https://example.com/page",
			},
			extract: {
				title: "<title>(.*?)</title>",
			},
		};

		const extractor = createDeclarativeExtractor(manifest);
		const match = extractor.match(new URL("https://example.com/page"));
		expect(match).toBeDefined();

		const result = await extractor.extract(
			new URL("https://example.com/page"),
			match!,
			mockContext,
		);

		expect(result).toEqual({
			title: "Test",
		});
	});

	it("runs a selector manifest", async () => {
		const manifest: VerticalManifest = {
			version: 1,
			name: "test_selector",
			kind: "selector",
			description: "Test selector",
			urlPatterns: ["https://example.com/page"],
			request: {
				urlTemplate: "https://example.com/page",
			},
			extract: {
				title: "title",
				body: "body",
			},
		};

		const extractor = createDeclarativeExtractor(manifest);
		const match = extractor.match(new URL("https://example.com/page"));
		expect(match).toBeDefined();

		const result = await extractor.extract(
			new URL("https://example.com/page"),
			match!,
			mockContext,
		);

		expect(result).toEqual({
			title: "Test",
			body: "Hello World",
		});
	});

	it("does not match unsupported URLs", () => {
		const manifest: VerticalManifest = {
			version: 1,
			name: "test_api",
			kind: "api-json",
			description: "Test API",
			urlPatterns: ["https://example.com/:id"],
			request: { urlTemplate: "https://api.example.com/{{id}}" },
			extract: { id: "$.id" },
		};

		const extractor = createDeclarativeExtractor(manifest);
		const match = extractor.match(new URL("https://other.com/42"));
		expect(match).toBeUndefined();
	});
});
