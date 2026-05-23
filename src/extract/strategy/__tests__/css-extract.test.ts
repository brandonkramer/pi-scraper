/** @file Tests for structured CSS extraction. */
import { describe, expect, it } from "vitest";

import { extractCssStructured } from "../css-extract.ts";

const HTML = `<!DOCTYPE html>
<html>
<body>
  <h1 class="title">Article Title</h1>
  <p class="author">John Doe</p>
  <div class="content">
    <p>First paragraph.</p>
    <p>Second paragraph.</p>
  </div>
  <div class="metadata">
    <span class="date">2026-05-23</span>
    <span class="tags">tech, programming</span>
  </div>
</body>
</html>`;

describe("css-extract", () => {
	it("extracts single values per selector", () => {
		const result = extractCssStructured({
			content: HTML,
			selectors: { title: "h1.title", author: "p.author" },
		});

		expect(result.fields.title).toEqual(["Article Title"]);
		expect(result.fields.author).toEqual(["John Doe"]);
		expect(result.matchedFields).toBe(2);
		expect(result.totalSelectors).toBe(2);
	});

	it("returns multiple values when limit > 1", () => {
		const result = extractCssStructured({
			content: HTML,
			selectors: { paragraphs: "p" },
			limit: 5,
		});

		expect(result.fields.paragraphs).toHaveLength(3);
		expect(result.matchedFields).toBe(1);
	});

	it("returns empty array for unmatched selectors", () => {
		const result = extractCssStructured({
			content: HTML,
			selectors: { nonexistent: ".does-not-exist" },
		});

		expect(result.fields.nonexistent).toEqual([]);
		expect(result.matchedFields).toBe(0);
	});

	it("extracts attributes when specified", () => {
		const result = extractCssStructured({
			content: HTML,
			selectors: { href: "a" },
			attribute: "href",
		});

		// No <a> tags in HTML
		expect(result.fields.href).toEqual([]);
	});
});
