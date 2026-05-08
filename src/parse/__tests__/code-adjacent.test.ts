/** @fileoverview Regression coverage for raw markdown, MDX, RST, and docstring parsing. */

import { describe, expect, it } from "vitest";
import { parseDocstrings } from "../docstrings.js";
import { parseMarkdown, parseMdx, parseRst } from "../markup-doc.js";

const tsSource = `/**
 * Fetch metrics for a project.
 * @param {string} project - Project slug.
 * @returns {Promise<number>} Count of metrics.
 * @example
 * await fetchMetrics("pi")
 */
export async function fetchMetrics(project: string): Promise<number> {
  return project.length;
}
`;

describe("code-adjacent parsers", () => {
	it("extracts markdown frontmatter, headings, links, and code blocks", () => {
		const doc = parseMarkdown(`---
title: API
private: false
---
# API

See [Guide](./guide.md).

\`\`\`ts
export const value = 1;
\`\`\`
`);

		expect(doc.frontmatter).toMatchObject({ title: "API", private: false });
		expect(doc.headings).toEqual([{ level: 1, text: "API", line: 1 }]);
		expect(doc.links[0]).toMatchObject({ text: "Guide", href: "./guide.md" });
		expect(doc.codeBlocks[0]).toMatchObject({ language: "ts" });
	});

	it("strips MDX components without a React runtime", () => {
		const doc = parseMdx(`# Intro

<Callout type="info" />

Use the API.
`);

		expect(doc.components?.[0]).toMatchObject({ name: "Callout" });
		expect(doc.text).toContain("Use the API");
		expect(doc.markdown).not.toContain("Callout");
	});

	it("extracts RST headings, directives, and code blocks", () => {
		const doc = parseRst(`API
===

.. code-block:: py

   print("ok")
`);

		expect(doc.headings[0]).toEqual({ level: 1, text: "API", line: 1 });
		expect(doc.directives?.[0]).toMatchObject({
			name: "code-block",
			value: "py",
		});
		expect(doc.codeBlocks[0]?.value).toContain("print");
	});

	it("extracts Python docstrings from definitions", () => {
		const docs = parseDocstrings(
			`def fetch_metrics(project):\n    """Fetch metrics for a project."""\n    return len(project)\n`,
			"metrics.py",
		);

		expect(docs.exports[0]).toMatchObject({
			name: "fetch_metrics",
			kind: "function",
			description: "Fetch metrics for a project.",
		});
	});

	it("extracts TSDoc/JSDoc export entries", () => {
		const docs = parseDocstrings(tsSource, "metrics.ts");

		expect(docs.exports[0]).toMatchObject({
			name: "fetchMetrics",
			kind: "function",
			description: "Fetch metrics for a project.",
		});
		expect(docs.exports[0]?.parameters?.[0]).toMatchObject({
			name: "project",
			type: "string",
		});
		expect(docs.exports[0]?.returns).toMatchObject({
			type: "Promise<number>",
		});
	});
});
