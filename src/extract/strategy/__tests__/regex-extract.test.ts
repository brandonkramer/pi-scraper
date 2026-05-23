/** @file Tests for structured regex extraction. */
import { describe, expect, it } from "vitest";

import { extractRegexStructured } from "../regex-extract.ts";

const TEXT_SAMPLE = `
Contact information:
Email: john@example.com
Phone: 555-123-4567
Alt Email: jane@example.org

Prices: $19.99, $5.00, $100.00
The order number is ORD-12345-ABC.
Reference: ORD-67890-XYZ.
`;

describe("regex-extract", () => {
	it("extracts single values per pattern", () => {
		const result = extractRegexStructured({
			content: TEXT_SAMPLE,
			selectors: {
				emails: "([\\w.+-]+@[\\w-]+\\.[\\w.]+)",
				phones: "(\\d{3}-\\d{3}-\\d{4})",
			},
		});

		expect(result.fields.emails).toContain("john@example.com");
		expect(result.fields.emails).toContain("jane@example.org");
		expect(result.fields.phones).toContain("555-123-4567");
		expect(result.matchedFields).toBe(2);
	});

	it("extracts structured patterns like order numbers", () => {
		const result = extractRegexStructured({
			content: TEXT_SAMPLE,
			selectors: {
				orders: "ORD-([A-Z0-9]+-[A-Z0-9]+)",
			},
		});

		expect(result.fields.orders).toContain("12345-ABC");
		expect(result.fields.orders).toContain("67890-XYZ");
		expect(result.matchedFields).toBe(1);
	});

	it("respects limit parameter", () => {
		const result = extractRegexStructured({
			content: TEXT_SAMPLE,
			selectors: {
				orders: "ORD-([A-Z0-9]+-[A-Z0-9]+)",
			},
			limit: 1,
		});

		expect(result.fields.orders).toHaveLength(1);
	});

	it("returns empty for unmatched patterns", () => {
		const result = extractRegexStructured({
			content: "No matches here.",
			selectors: {
				missing: "(DOES_NOT_EXIST_\\d+)",
			},
		});

		expect(result.fields.missing).toEqual([]);
		expect(result.matchedFields).toBe(0);
	});

	it("handles whole-pattern extraction (no capture group)", () => {
		const result = extractRegexStructured({
			content: "Price: $99.99",
			selectors: {
				prices: "\\$\\d+\\.\\d{2}",
			},
		});

		expect(result.fields.prices).toContain("$99.99");
	});

	it("handles invalid regex gracefully", () => {
		const result = extractRegexStructured({
			content: "some text",
			selectors: {
				bad: "[invalid-regex(",
			},
		});

		expect(result.fields.bad).toEqual([]);
		expect(result.matchedFields).toBe(0);
	});

	it("skips empty matches", () => {
		const result = extractRegexStructured({
			content: "word1 word2 ",
			selectors: {
				words: "\\s+(.*?)\\s+",
			},
		});

		// Should only include non-empty matches
		for (const val of result.fields.words) {
			expect(val.trim().length).toBeGreaterThan(0);
		}
	});
});
