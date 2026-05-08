/**
 * @fileoverview serialize __tests__ serialize.test module.
 */
import { describe, expect, it } from "vitest";
import { extractReadable } from "../../parse/readable.js";
import { htmlToMarkdown } from "../markdown.js";
import { stableJson, toLlmText } from "../json.js";
import { normalizeWhitespace } from "../text.js";

describe("serialization", () => {
  it("converts html to stable markdown and removes scripts/images by default", () => {
    const markdown = htmlToMarkdown(`<article><h1>Hello</h1><p>Read <a href="/docs">docs</a>.</p><img src="x"><script>bad()</script></article>`);
    expect(markdown).toBe("# Hello\n\nRead [docs](/docs).");
  });

  it("normalizes text and produces stable JSON/LLM output", () => {
    expect(normalizeWhitespace(" A\t lot\n\n\n of   space ")).toBe("A lot\n\nof space");
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}');
    expect(toLlmText({ title: "Title", text: "Body", metadata: { source: "fixture" } })).toContain("# Title");
  });
});

describe("extractReadable", () => {
  it("extracts article text when readerable", () => {
    const paragraphs = Array.from({ length: 8 }, (_, index) =>
      `<p>Paragraph ${index} contains substantial article prose for readability extraction and meaningful text density.</p>`).join("");
    const result = extractReadable(`<html><body><article><h1>Readable Title</h1>${paragraphs}</article></body></html>`, "https://example.com/article");
    expect(result.ok).toBe(true);
    expect(result.title).toContain("Readable Title");
    expect(result.textContent).toContain("substantial article prose");
  });

  it("returns unsuitable for sparse pages", () => {
    const result = extractReadable("<html><body><p>Short.</p></body></html>", "https://example.com/");
    expect(result.ok).toBe(false);
  });
});
