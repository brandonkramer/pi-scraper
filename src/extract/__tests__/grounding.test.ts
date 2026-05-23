/** @file Tests for source-grounded extraction post-hoc matcher. */

import { describe, expect, it } from "vitest";

import { groundExtractionResult } from "../grounding.ts";

describe("groundExtractionResult", () => {
	const sourceText =
		"# Product Page\n\nTitle: Super Widget\nPrice: $19.99\nDescription: A great widget for everyday use.";

	it("finds exact string matches with char offsets", () => {
		const data = { title: "Super Widget", price: "$19.99" };
		const grounded = groundExtractionResult(data, sourceText);
		expect(grounded).toHaveLength(2);

		const title = grounded.find((g) => g.field === "title");
		expect(title?.value).toBe("Super Widget");
		// "Super Widget" appears after "Title: " in the source text
		expect(title?.sourceSpan).toEqual({ start: 23, end: 35 });

		const price = grounded.find((g) => g.field === "price");
		expect(price?.value).toBe("$19.99");
		// "$19.99" appears after "Price: " (6 chars long)
		expect(price?.sourceSpan).toEqual({ start: 43, end: 49 });
	});

	it("marks unverifiable fields with null span", () => {
		const data = { title: "Super Widget", madeUp: "not in text" };
		const grounded = groundExtractionResult(data, sourceText);
		const madeUp = grounded.find((g) => g.field === "madeUp");
		expect(madeUp?.sourceSpan).toBeNull();
	});

	it("handles nested objects with dot-notation paths", () => {
		const data = { product: { title: "Super Widget", price: "$19.99" } };
		const grounded = groundExtractionResult(data, sourceText);
		expect(grounded).toHaveLength(2);

		const title = grounded.find((g) => g.field === "product.title");
		expect(title?.sourceSpan).toEqual({ start: 23, end: 35 });

		const price = grounded.find((g) => g.field === "product.price");
		expect(price?.sourceSpan).toEqual({ start: 43, end: 49 });
	});

	it("handles arrays with indexed paths", () => {
		const data = { items: ["Super Widget", "$19.99"] };
		const grounded = groundExtractionResult(data, sourceText);
		expect(grounded).toHaveLength(2);

		const first = grounded.find((g) => g.field === "items.0");
		expect(first?.sourceSpan).toEqual({ start: 23, end: 35 });

		const second = grounded.find((g) => g.field === "items.1");
		expect(second?.sourceSpan).toEqual({ start: 43, end: 49 });
	});

	it("handles arrays of objects", () => {
		const data = { products: [{ title: "Super Widget" }, { price: "$19.99" }] };
		const grounded = groundExtractionResult(data, sourceText);
		const t0 = grounded.find((g) => g.field === "products.0.title");
		expect(t0?.sourceSpan).toEqual({ start: 23, end: 35 });
		const p1 = grounded.find((g) => g.field === "products.1.price");
		expect(p1?.sourceSpan).toEqual({ start: 43, end: 49 });
	});

	it("finds case-insensitive matches", () => {
		const data = { title: "super widget" };
		const grounded = groundExtractionResult(data, sourceText);
		const title = grounded.find((g) => g.field === "title");
		expect(title?.sourceSpan).toEqual({ start: 23, end: 35 });
	});

	it("finds whitespace-collapsed matches", () => {
		const text = "A  great   widget for everyday use.";
		const data = { desc: "A great widget for everyday use." };
		const grounded = groundExtractionResult(data, text);
		const desc = grounded.find((g) => g.field === "desc");
		expect(desc?.sourceSpan).not.toBeNull();
	});

	it("handles numbers by string representation", () => {
		const text = "Price is 19.99 dollars";
		const data = { price: 19.99 };
		const grounded = groundExtractionResult(data, text);
		const price = grounded.find((g) => g.field === "price");
		expect(price?.sourceSpan).not.toBeNull();
	});

	it("handles booleans by string representation", () => {
		const text = "Availability: true";
		const data = { available: true };
		const grounded = groundExtractionResult(data, text);
		const available = grounded.find((g) => g.field === "available");
		expect(available?.sourceSpan).not.toBeNull();
	});

	it("handles null and undefined values", () => {
		const data = { title: null, desc: undefined, name: "Super Widget" };
		const grounded = groundExtractionResult(data, sourceText);
		expect(grounded).toHaveLength(3);
		const title = grounded.find((g) => g.field === "title");
		expect(title?.sourceSpan).toBeNull();
		const desc = grounded.find((g) => g.field === "desc");
		expect(desc?.sourceSpan).toBeNull();
	});

	it("handles empty objects and arrays", () => {
		const data = { empty: {}, list: [] };
		const grounded = groundExtractionResult(data, sourceText);
		expect(grounded).toHaveLength(2);
		expect(grounded[0].field).toBe("empty");
		expect(grounded[1].field).toBe("list");
	});

	it("returns span for primitive root value when found", () => {
		const grounded = groundExtractionResult("Super Widget", sourceText);
		expect(grounded).toHaveLength(1);
		expect(grounded[0].field).toBe("(root)");
		expect(grounded[0].sourceSpan).toEqual({ start: 23, end: 35 });
	});
});
