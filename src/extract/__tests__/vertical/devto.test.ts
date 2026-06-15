/** @file Dev.to vertical extractor tests. */
import { describe, expect, it, vi } from "vitest";

import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import {
	buildManifestRegistry,
	clearManifestRegistryCache,
} from "../../vertical/manifest-registry.ts";
import { runVerticalExtractor } from "../../vertical/registry.ts";

const signal = new AbortController().signal;

function articleResponse() {
	return {
		id: 12345,
		title: "Building a Dev.to Extractor",
		description: "A short guide to extracting Dev.to articles.",
		body_markdown: "# Building a Dev.to Extractor\n\nUse the Forem API.",
		tag_list: ["webdev", "api"],
		published_at: "2026-06-15T10:00:00Z",
		readable_publish_date: "Jun 15",
		reading_time_minutes: 4,
		url: "https://dev.to/jane/building-a-devto-extractor",
		canonical_url: "https://dev.to/jane/building-a-devto-extractor",
		cover_image: "https://example.com/cover.png",
		comments_count: 2,
		user: {
			name: "Jane Developer",
			username: "jane",
			website_url: "https://jane.example",
			profile_image: "https://example.com/jane.png",
			twitter_username: "janedev",
			github_username: "jane",
		},
	};
}

function commentsResponse() {
	return [
		{
			id_code: "root",
			body_html: "<p>Great article.</p>",
			created_at: "2026-06-15T11:00:00Z",
			user: { user_id: 1, username: "reader", name: "Reader", profile_image: "reader.png" },
			children: [
				{
					id_code: "child",
					body_html: "<p>Thanks!</p>",
					created_at: "2026-06-15T11:05:00Z",
					user: { user_id: 2, username: "jane", name: "Jane", profile_image: "jane.png" },
				},
			],
		},
	];
}

function apiContext(): VerticalExtractorContext {
	return {
		fetchPage: vi.fn(async (url: string) => {
			if (url === "https://dev.to/api/articles/jane/building-a-devto-extractor") {
				return jsonPage(url, articleResponse());
			}
			if (url === "https://dev.to/api/comments?a_id=12345")
				return jsonPage(url, commentsResponse());
			throw new Error(`Unexpected URL: ${url}`);
		}),
		fetchJson: vi.fn(),
	};
}

function fallbackContext(): VerticalExtractorContext {
	const html = `<!doctype html><html><head><title>Fallback Dev.to Title</title></head><body><article><h1>Fallback Dev.to Title</h1>${Array.from(
		{ length: 8 },
		() =>
			"<p>This fallback article paragraph has enough meaningful prose for readability extraction from the Dev.to page.</p>",
	).join("")}</article></body></html>`;
	return {
		fetchPage: vi.fn(async (url: string) => {
			if (url.startsWith("https://dev.to/api/articles/")) throw new Error("API unavailable");
			if (url === "https://dev.to/jane/building-a-devto-extractor") {
				return { text: html, finalUrl: url, status: 200, contentType: "text/html" };
			}
			throw new Error(`Unexpected URL: ${url}`);
		}),
		fetchJson: vi.fn(),
	};
}

function jsonPage(url: string, value: unknown) {
	return {
		text: JSON.stringify(value),
		finalUrl: url,
		status: 200,
		contentType: "application/json",
	};
}

describe("devto vertical extractor", () => {
	it("matches Dev.to article and comment URLs", async () => {
		clearManifestRegistryCache();
		const registry = await buildManifestRegistry(false);
		const article = registry.match(new URL("https://dev.to/jane/building-a-devto-extractor"));
		expect(article?.entry.manifest.name).toBe("devto");
		expect(article?.captures).toEqual({ username: "jane", slug: "building-a-devto-extractor" });

		const comment = registry.match(
			new URL("https://dev.to/jane/building-a-devto-extractor/abc123"),
		);
		expect(comment?.entry.manifest.name).toBe("devto");
		expect(comment?.captures).toEqual({
			username: "jane",
			slug: "building-a-devto-extractor",
			commentId: "abc123",
		});
	});

	it("extracts article metadata, body markdown, author, and comments", async () => {
		const result = await runVerticalExtractor(
			"devto",
			"https://dev.to/jane/building-a-devto-extractor",
			{ context: apiContext() },
			signal,
		);

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			id: 12345,
			username: "jane",
			slug: "building-a-devto-extractor",
			title: "Building a Dev.to Extractor",
			description: "A short guide to extracting Dev.to articles.",
			bodyMarkdown: "# Building a Dev.to Extractor\n\nUse the Forem API.",
			tags: ["webdev", "api"],
			publishedAt: "2026-06-15T10:00:00Z",
			readingTimeMinutes: 4,
			commentsCount: 2,
			author: {
				username: "jane",
				name: "Jane Developer",
				profileUrl: "https://jane.example",
			},
			comments: [
				{ id: "root", author: "Reader", username: "reader", bodyHtml: "<p>Great article.</p>" },
				{ id: "child", author: "Jane", username: "jane", bodyHtml: "<p>Thanks!</p>" },
			],
		});
	});

	it("falls back to page readability when the API is unavailable", async () => {
		const result = await runVerticalExtractor(
			"devto",
			"https://dev.to/jane/building-a-devto-extractor",
			{ context: fallbackContext() },
			signal,
		);

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			username: "jane",
			slug: "building-a-devto-extractor",
			title: "Fallback Dev.to Title",
			author: { username: "jane" },
			comments: [],
			source: { provider: "devto", fallback: true },
		});
		expect((result.data as { body?: string }).body).toContain("fallback article paragraph");
	});
});
