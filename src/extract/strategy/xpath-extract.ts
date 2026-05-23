/**
 * @file Structured XPath extraction — field-mapped XPath → JSON. Converts common XPath patterns to
 *   CSS selectors for htmlparser2/css-select. Not a full XPath evaluator — handles the common
 *   patterns needed for structured extraction:
 *
 *   - `//tag` → `tag`
 *   - `//tag[@class="foo"]` → `tag.foo`
 *   - `//tag[@id="bar"]` → `tag#bar`
 *   - `/html/body/div` → `html > body > div`
 *   - `//div[@class="foo"]/p` → `div.foo > p`
 */
import { selectAll } from "css-select";
import { type AnyNode } from "domhandler";
import { textContent } from "domutils";
import { parseDocument } from "htmlparser2";

export interface XpathExtractParams {
	/** HTML content. */
	content: string;
	/** Field → XPath selector mapping. */
	selectors: Record<string, string>;
	/** Attribute to extract (optional). */
	attribute?: string;
	/** Max results per selector (default 1). */
	limit?: number;
}

export interface XpathExtractResult {
	fields: Record<string, string[]>;
	matchedFields: number;
	totalSelectors: number;
}

/** Run structured XPath extraction (via CSS conversion) against HTML content. */
export function extractXpathStructured(params: XpathExtractParams): XpathExtractResult {
	const document = parseDocument(params.content, {
		lowerCaseAttributeNames: true,
		lowerCaseTags: true,
	});

	const limit = params.limit ?? 1;
	const fields: Record<string, string[]> = {};
	let matchedFields = 0;

	for (const [field, xpath] of Object.entries(params.selectors)) {
		const css = xpathToCss(xpath);
		if (!css) {
			fields[field] = [];
			continue;
		}
		const elements = selectAll(css, document.children);
		const values: string[] = [];
		for (let i = 0; i < elements.length && i < limit; i++) {
			values.push(extractValue(elements[i], params.attribute));
		}
		fields[field] = values;
		if (values.length > 0) matchedFields++;
	}

	return {
		fields,
		matchedFields,
		totalSelectors: Object.keys(params.selectors).length,
	};
}

/**
 * Convert a common XPath expression to a CSS selector.
 *
 * Supports:
 *
 * - `//tag` → `tag`
 * - `//tag[@class="foo"]` → `tag.foo`
 * - `//tag[@id="bar"]` → `tag#bar`
 * - `/html/body/div` → `html > body > div`
 * - `//div[@class="foo"]/p` → `div.foo > p`
 * - `//*[@class="foo"]` → `[class~="foo"]`
 * - `//tag[contains(@class, "foo")]` → `tag.foo`
 */
export function xpathToCss(xpath: string): string | undefined {
	if (!xpath) return undefined;

	// Strip leading // or /
	let rest = xpath.trim();
	let descendant = true;
	if (rest.startsWith("//")) {
		rest = rest.slice(2);
	} else if (rest.startsWith("/")) {
		rest = rest.slice(1);
		descendant = false;
	} else {
		// Already CSS-like
		return xpath;
	}

	const steps = splitSteps(rest);
	const cssParts: string[] = [];

	for (const step of steps) {
		const css = stepToCss(step, descendant);
		if (!css) return undefined;
		cssParts.push(css);
		// Only the first step is descendant
		descendant = false;
	}

	return cssParts.join(" > ");
}

interface XpathStep {
	tag: string;
	attrs: Array<{ name: string; op: string; value: string }>;
	predicates: string[];
}

function splitSteps(xpath: string): string[] {
	const steps: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of xpath) {
		if (ch === "[") depth++;
		else if (ch === "]") depth--;
		if (ch === "/" && depth === 0) {
			if (current) steps.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	if (current) steps.push(current);
	return steps;
}

function stepToCss(step: string, _isDescendant: boolean): string | undefined {
	const parsed = parseStep(step);
	if (!parsed) return undefined;

	const { tag, attrs } = parsed;
	let css = tag === "*" ? "" : tag;

	for (const attr of attrs) {
		if (attr.name === "class" && attr.op === "=") {
			css += `.${cssSafe(attr.value)}`;
		} else if (attr.name === "id" && attr.op === "=") {
			css += `#${cssSafe(attr.value)}`;
		} else if (attr.name === "class" && attr.op === "contains") {
			css += `.${cssSafe(attr.value)}`;
		} else if (attr.op === "=") {
			css += `[${attr.name}="${cssSafe(attr.value)}"]`;
		} else if (attr.op === "contains") {
			css += `[class~="${cssSafe(attr.value)}"]`;
		}
	}

	return css || undefined;
}

function parseStep(step: string): XpathStep | undefined {
	// Parse tag + predicates like: div[@class="foo"][@id="bar"]
	const match = step.match(/^([a-zA-Z0-9_*-]+)(.*)$/u);
	if (!match) return undefined;

	const tag = match[1];
	const predicateStr = match[2];
	const attrs: Array<{ name: string; op: string; value: string }> = [];

	// Extract [...] predicates
	const predRegex = /\[([^\]]+)\]/gu;
	let predMatch: RegExpExecArray | null;
	while ((predMatch = predRegex.exec(predicateStr)) !== null) {
		const inner = predMatch[1];

		// contains(@class, "foo")
		const containsMatch = inner.match(/^contains\s*\(\s*@(\w+)\s*,\s*"([^"]*)"\s*\)$/u);
		if (containsMatch) {
			attrs.push({
				name: containsMatch[1],
				op: "contains",
				value: containsMatch[2],
			});
			continue;
		}

		// @attr="value"
		const eqMatch = inner.match(/^@(\w+)\s*=\s*"([^"]*)"$/u);
		if (eqMatch) {
			attrs.push({ name: eqMatch[1], op: "=", value: eqMatch[2] });
			continue;
		}

		// @attr (presence check) — unsupported, skip
		// text()="value" — unsupported, skip
	}

	return { tag, attrs, predicates: [] };
}

function cssSafe(value: string): string {
	return value.replaceAll(/[^a-zA-Z0-9_-]/gu, "\\$&");
}

function extractValue(element: AnyNode, attribute?: string): string {
	if (attribute && "attribs" in element) {
		return (element as AnyNode & { attribs: Record<string, string> }).attribs[attribute] ?? "";
	}
	return textContent(element as Parameters<typeof textContent>[0]).trim();
}
