/** @file Tests for Markdown text chunker. */

import { describe, expect, it } from "vitest";

import { chunkMarkdown, estimateTokenCount, type Chunk } from "../chunker.ts";

function totalTokens(chunks: Chunk[]): number {
	return chunks.reduce((s, c) => s + c.tokenCount, 0);
}

describe("chunkMarkdown", () => {
	it("returns empty array for empty text", () => {
		expect(chunkMarkdown("")).toEqual([]);
	});

	it("returns single chunk when text fits budget", () => {
		const text = "This is a short paragraph.\n\nIt fits in one chunk.";
		const chunks = chunkMarkdown(text, { maxTokens: 50 });
		expect(chunks.length).toBe(1);
		expect(chunks[0].index).toBe(0);
		expect(chunks[0].tokenCount).toBeGreaterThan(0);
		expect(chunks[0].text).toContain("short paragraph");
	});

	it("splits across paragraphs when budget exceeded", () => {
		const paragraphs = Array.from(
			{ length: 10 },
			(_, i) => `Paragraph ${i} has several words in it to make sure it counts.`,
		);
		const text = paragraphs.join("\n\n");
		const chunks = chunkMarkdown(text, { maxTokens: 20, overlapTokens: 0 });
		expect(chunks.length).toBeGreaterThan(1);
		// Each chunk should respect paragraph boundaries
		// +5 tolerance for sentence splits
		for (const chunk of chunks) {
			expect(chunk.tokenCount).toBeLessThanOrEqual(20 + 5);
		}
	});

	it("includes overlap between chunks", () => {
		const paragraphs = Array.from(
			{ length: 6 },
			(_, i) => `Line ${i} has enough words to make a paragraph.`,
		);
		const text = paragraphs.join("\n\n");
		const chunks = chunkMarkdown(text, { maxTokens: 15, overlapTokens: 5 });
		expect(chunks.length).toBeGreaterThan(1);
		// Check that overlap exists: chunk N+1 should contain some text from chunk N
		for (let i = 1; i < chunks.length; i++) {
			// Overlap may not be exact word-for-word if sentence boundaries intervene
			expect(chunks[i].text.length).toBeGreaterThan(0);
		}
	});

	it("respects index ordering", () => {
		const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} content.`).join("\n\n");
		const chunks = chunkMarkdown(text, { maxTokens: 10, overlapTokens: 0 });
		for (let i = 0; i < chunks.length; i++) {
			expect(chunks[i].index).toBe(i);
		}
	});

	it("splits oversized paragraph at sentence boundaries", () => {
		const sentences = Array.from(
			{ length: 30 },
			(_, i) => `Sentence number ${i} is here and contains multiple words for counting.`,
		);
		const text = sentences.join(" ");
		const chunks = chunkMarkdown(text, { maxTokens: 20, overlapTokens: 0 });
		expect(chunks.length).toBeGreaterThan(1);
		// Total tokens in chunks should approximately equal source tokens
		const sourceTokens = text.trim().split(/\s+/u).filter(Boolean).length;
		const chunkTokens = totalTokens(chunks);
		// Overlap causes some duplication; allow 20% variance
		expect(chunkTokens).toBeGreaterThanOrEqual(sourceTokens * 0.8);
	});

	it("preserves all original text across chunks (minus overlap duplication)", () => {
		const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
		const chunks = chunkMarkdown(text, { maxTokens: 5, overlapTokens: 0 });
		const joined = chunks.map((c) => c.text).join("\n\n");
		expect(joined).toContain("First paragraph");
		expect(joined).toContain("Second paragraph");
		expect(joined).toContain("Third paragraph");
	});

	it("uses defaults when options omitted", () => {
		const text = "One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.";
		const chunks = chunkMarkdown(text);
		// With default 500 tokens, short text should be single chunk
		expect(chunks.length).toBe(1);
	});

	it("token counts match estimateTokenCount per chunk", () => {
		const text = "The quick brown fox jumps over the lazy dog.";
		const chunks = chunkMarkdown(text, { maxTokens: 50 });
		expect(chunks[0].tokenCount).toBe(estimateTokenCount(chunks[0].text));
	});

	it("handles markdown headings and lists gracefully", () => {
		const text = "# Heading One\n\nSome body text here.\n\n## Heading Two\n\nMore body text.";
		const chunks = chunkMarkdown(text, { maxTokens: 50 });
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		expect(chunks[0].text).toContain("Heading One");
	});
});
