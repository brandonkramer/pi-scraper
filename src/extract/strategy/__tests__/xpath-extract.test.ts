/** @file Tests for structured XPath extraction and XPath→CSS conversion. */
import { describe, expect, it } from "vitest";

import { extractXpathStructured, xpathToCss } from "../xpath-extract.ts";

const HTML = `<!DOCTYPE html>
<html>
<body>
  <h1 class="title">Article Title</h1>
  <p class="author">John Doe</p>
  <div class="content">
    <p>First paragraph.</p>
  </div>
  <ul>
    <li>Item 1</li>
    <li>Item 2</li>
  </ul>
</body>
</html>`;

describe("xpath-to-css", () => {
	it("converts //tag to tag", () => {
		expect(xpathToCss("//h1")).toBe("h1");
	});

	it("converts //tag[@class='foo'] to tag.foo", () => {
		expect(xpathToCss('//h1[@class="title"]')).toBe("h1.title");
	});

	it("converts //tag[@id='bar'] to tag#bar", () => {
		expect(xpathToCss('//div[@id="main"]')).toBe("div#main");
	});

	it("converts /html/body/div to html > body > div", () => {
		expect(xpathToCss("/html/body/div")).toBe("html > body > div");
	});

	it("converts //div[@class='foo']/p to div.foo > p", () => {
		expect(xpathToCss('//div[@class="foo"]/p')).toBe("div.foo > p");
	});

	it("returns undefined for empty input", () => {
		expect(xpathToCss("")).toBeUndefined();
	});
});

describe("xpath-extract", () => {
	it("extracts single values per XPath selector", () => {
		const result = extractXpathStructured({
			content: HTML,
			selectors: { title: '//h1[@class="title"]', author: "//p[@class='author']" },
		});

		expect(result.fields.title).toEqual(["Article Title"]);
		expect(result.fields.author).toEqual(["John Doe"]);
		expect(result.matchedFields).toBe(2);
	});

	it("extracts list items", () => {
		const result = extractXpathStructured({
			content: HTML,
			selectors: { items: "//li" },
			limit: 5,
		});

		expect(result.fields.items).toEqual(["Item 1", "Item 2"]);
		expect(result.matchedFields).toBe(1);
	});

	it("returns empty for unmatched selectors", () => {
		const result = extractXpathStructured({
			content: HTML,
			selectors: { missing: '//div[@class="nope"]' },
		});

		expect(result.fields.missing).toEqual([]);
		expect(result.matchedFields).toBe(0);
	});
});
