/**
 * @file Structured CSS extraction — field-mapped selector → JSON. Given a map of field names to CSS
 *   selectors, parses HTML and returns a flat JSON object with each field's extracted text.
 */
import { selectAll } from "css-select";
import { type AnyNode } from "domhandler";
import { textContent } from "domutils";
import { parseDocument } from "htmlparser2";

export interface CssExtractParams {
	/** HTML or URL content. */
	content: string;
	/** Field → CSS selector mapping. */
	selectors: Record<string, string>;
	/** Attribute to extract instead of text content (optional). */
	attribute?: string;
	/** Max results per selector (default 1). */
	limit?: number;
}

export interface CssExtractResult {
	/** Extracted values per field. */
	fields: Record<string, string[]>;
	/** Number of selectors that matched at least one element. */
	matchedFields: number;
	/** Total selectors provided. */
	totalSelectors: number;
}

/** Run structured CSS extraction against HTML content. */
export function extractCssStructured(params: CssExtractParams): CssExtractResult {
	const document = parseDocument(params.content, {
		lowerCaseAttributeNames: true,
		lowerCaseTags: true,
	});

	const limit = params.limit ?? 1;
	const fields: Record<string, string[]> = {};
	let matchedFields = 0;

	for (const [field, selector] of Object.entries(params.selectors)) {
		const elements = selectAll(selector, document.children);
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

function extractValue(element: AnyNode, attribute?: string): string {
	if (attribute && "attribs" in element) {
		return (element as AnyNode & { attribs: Record<string, string> }).attribs[attribute] ?? "";
	}
	return textContent(element as Parameters<typeof textContent>[0]).trim();
}
