/**
 * @fileoverview parse __tests__ adaptive-selector.test module.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "htmlparser2";
import { runAdaptiveSelector } from "../adaptive/selector.ts";
import {
	fingerprintElement,
	type ElementFingerprint,
} from "../adaptive/fingerprint.ts";

describe("adaptive selector", () => {
	it("directly selects matching elements", async () => {
		const html = `<html><body>
			<div class="product-card"><h2>Product 1</h2></div>
			<div class="product-card"><h2>Product 2</h2></div>
		</body></html>`;
		const doc = parseDocument(html);
		const saved = new Map<string, ElementFingerprint>();

		const result = await runAdaptiveSelector(
			doc,
			{
				selector: ".product-card",
				selectorType: "css",
				identifier: "products",
				adaptive: false,
				autoSave: false,
				threshold: 0.35,
				limit: 10,
			},
			(id) => Promise.resolve(saved.get(id)),
			(id, fp) => {
				saved.set(id, fp);
				return Promise.resolve();
			},
		);

		expect(result.strategy).toBe("direct");
		expect(result.directMatches).toBe(2);
		expect(result.elements.length).toBe(2);
	});

	it("saves fingerprint with autoSave", async () => {
		const html = `<html><body><div class="target">Hello</div></body></html>`;
		const doc = parseDocument(html);
		const saved = new Map<string, ElementFingerprint>();

		const result = await runAdaptiveSelector(
			doc,
			{
				selector: ".target",
				selectorType: "css",
				identifier: "my-target",
				adaptive: false,
				autoSave: true,
				threshold: 0.35,
				limit: 10,
			},
			(id) => Promise.resolve(saved.get(id)),
			(id, fp) => {
				saved.set(id, fp);
				return Promise.resolve();
			},
		);

		expect(result.saved).toBe(true);
		expect(saved.has("my-target")).toBe(true);
	});

	it("relocates element after markup change", async () => {
		// Page v1
		const html1 = `<html><body>
			<div class="container">
				<section class="products">
					<article class="product" id="p1"><h3>Product 1</h3></article>
				</section>
			</div>
		</body></html>`;
		// Page v2: class changed, path changed, but content preserved
		const html2 = `<html><body>
			<div class="new-container">
				<div class="product-wrapper">
					<section class="products">
						<article class="product new-class" data-id="p1"><h3>Product 1</h3></article>
					</section>
				</div>
			</div>
		</body></html>`;

		const doc1 = parseDocument(html1);
		const doc2 = parseDocument(html2);
		const saved = new Map<string, ElementFingerprint>();

		// First: save fingerprint
		await runAdaptiveSelector(
			doc1,
			{
				selector: "#p1",
				selectorType: "css",
				identifier: "product-p1",
				adaptive: false,
				autoSave: true,
				threshold: 0.35,
				limit: 10,
			},
			(id) => Promise.resolve(saved.get(id)),
			(id, fp) => {
				saved.set(id, fp);
				return Promise.resolve();
			},
		);

		// Second: selector changes but content preserved - should adaptively relocate
		const result = await runAdaptiveSelector(
			doc2,
			{
				selector: "#p1", // old selector doesn't match anymore
				selectorType: "css",
				identifier: "product-p1",
				adaptive: true,
				autoSave: false,
				threshold: 0.3,
				limit: 10,
			},
			(id) => Promise.resolve(saved.get(id)),
			(id, fp) => {
				saved.set(id, fp);
				return Promise.resolve();
			},
		);

		expect(result.strategy).toBe("adaptive");
		expect(result.elements.length).toBeGreaterThan(0);
		expect(result.score).toBeGreaterThan(0.3);
	});

	it("returns none when no match and no stored fingerprint", async () => {
		const html = `<html><body><div>Hello</div></body></html>`;
		const doc = parseDocument(html);

		const result = await runAdaptiveSelector(
			doc,
			{
				selector: ".missing",
				selectorType: "css",
				identifier: "missing",
				adaptive: true,
				autoSave: false,
				threshold: 0.35,
				limit: 10,
			},
			() => Promise.resolve(undefined),
			() => Promise.resolve(),
		);

		expect(result.strategy).toBe("none");
		expect(result.elements.length).toBe(0);
	});
});
