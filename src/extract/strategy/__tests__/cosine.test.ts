/** @file Tests for cosine similarity extraction. */
import { describe, expect, it } from "vitest";

import { scoreTextByCosine } from "../cosine.ts";

describe("cosine similarity", () => {
	describe("scoreTextByCosine", () => {
		it("returns top-N scoring blocks for a matching query", () => {
			const text = [
				"Node.js is a JavaScript runtime built on Chrome's V8 engine.",
				"Python is a high-level programming language with dynamic semantics.",
				"The V8 JavaScript engine powers Node.js and Chrome.",
				"TypeScript adds static typing to JavaScript.",
			].join("\n\n");

			const result = scoreTextByCosine(text, "Node.js V8 runtime", 3, 0.0, 200);

			expect(result.totalBlocks).toBeGreaterThanOrEqual(2);
			expect(result.blocks.length).toBeGreaterThan(0);
			// Blocks mentioning "Node.js" and "V8" should score higher
			const first = result.blocks[0];
			expect(first.score).toBeGreaterThan(0);
			expect(first.text.toLowerCase()).toContain("node");
		});

		it("returns empty array for empty text", () => {
			const result = scoreTextByCosine("", "query", 5);
			expect(result.blocks).toHaveLength(0);
			expect(result.totalBlocks).toBe(0);
		});

		it("respects topN limit", () => {
			const text = Array.from({ length: 10 }, (_, i) => `This is block number ${i + 1}.`).join(
				"\n\n",
			);
			const result = scoreTextByCosine(text, "block number", 3);
			expect(result.blocks.length).toBeLessThanOrEqual(3);
		});

		it("respects minScore threshold, filtering low-scoring blocks", () => {
			const text =
				"The red apple is a fruit.\n\nThe blue car is a vehicle.\n\nThe sweet banana is a fruit.";
			const result = scoreTextByCosine(text, "car vehicle automobile", 5, 0.02, 64);
			expect(result.blocks.length).toBeGreaterThanOrEqual(1);
			const top = result.blocks[0];
			expect(top.text.toLowerCase()).toContain("car");
			expect(top.score).toBeGreaterThan(0.01);
		});

		it("includes charStart and charEnd positions", () => {
			const text = "First paragraph about topic A.\n\nSecond paragraph about topic B.";
			const result = scoreTextByCosine(text, "topic", 5);
			for (const block of result.blocks) {
				expect(block.charStart).toBeGreaterThanOrEqual(0);
				expect(block.charEnd).toBeGreaterThan(block.charStart);
			}
		});

		it("normalizes query case", () => {
			const text = "The QUICK brown fox jumps over the lazy dog.";
			const result = scoreTextByCosine(text, "quick fox", 1);
			expect(result.blocks.length).toBe(1);
			expect(result.blocks[0].score).toBeGreaterThan(0);
		});
	});
});
