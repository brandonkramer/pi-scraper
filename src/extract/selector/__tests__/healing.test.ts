/** @file Tests for selector self-healing (text-anchor heuristic). */

import { parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";

import { healSelectorMatch, parseSelectorSignals } from "../healing.ts";

describe("parseSelectorSignals", () => {
	it("extracts tag", () => {
		const s = parseSelectorSignals("article.content");
		expect(s.tag).toBe("article");
		expect(s.classes).toContain("content");
	});

	it("extracts multiple classes", () => {
		const s = parseSelectorSignals("div.container.main");
		expect(s.tag).toBe("div");
		expect(s.classes).toEqual(["container", "main"]);
	});

	it("extracts id", () => {
		const s = parseSelectorSignals("#hero");
		expect(s.id).toBe("hero");
		expect(s.tag).toBeUndefined();
	});

	it("extracts attributes", () => {
		const s = parseSelectorSignals('button[data-role="primary"]');
		expect(s.tag).toBe("button");
		expect(s.attributes["data-role"]).toBe("primary");
	});

	it("returns empty for complex selector", () => {
		const s = parseSelectorSignals("div > span:nth-child(2)");
		expect(s.tag).toBe("div");
		expect(s.classes).toEqual([]);
	});
});

describe("healSelectorMatch", () => {
	it("finds semantic neighbor by tag + class", () => {
		const html = `
			<div class="wrapper">
				<article class="content old-class">First article</article>
				<article class="content new-class">Second article</article>
			</div>
		`;
		const doc = parseDocument(html);
		const healed = healSelectorMatch(doc, "article.content", 0.3);
		expect(healed.length).toBeGreaterThanOrEqual(1);
		expect(healed[0].score).toBeGreaterThanOrEqual(0.3);
		expect(healed[0].reasons.tag).toBe(1);
		expect(healed[0].reasons.class).toBeGreaterThan(0);
	});

	it("uses fingerprint text to boost score", () => {
		const html = `
			<div>
				<p>Original product description here</p>
				<p>Updated product description here</p>
			</div>
		`;
		const doc = parseDocument(html);
		const fingerprint = {
			tag: "p",
			attributes: {},
			text: "Original product description here",
			fullText: "Original product description here",
			path: ["html", "body", "div", "p"],
		};
		const healed = healSelectorMatch(doc, "p.description", 0.3, fingerprint);
		expect(healed.length).toBeGreaterThanOrEqual(1);
		expect(healed[0].reasons.text).toBeGreaterThan(0.5);
	});

	it("returns empty when nothing meets threshold", () => {
		const html = `<div><span>nothing</span></div>`;
		const doc = parseDocument(html);
		const healed = healSelectorMatch(doc, "footer.links", 0.9);
		expect(healed).toEqual([]);
	});

	it("sorts candidates by descending score", () => {
		const html = `
			<div>
				<article class="content">Best match text</article>
				<article class="content">Worse match</article>
				<section class="content">Wrong tag</section>
			</div>
		`;
		const doc = parseDocument(html);
		const healed = healSelectorMatch(doc, "article.content", 0.2);
		expect(healed.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < healed.length; i++) {
			expect(healed[i - 1].score).toBeGreaterThanOrEqual(healed[i].score);
		}
	});

	it("finds parent tag match when fingerprint has parent", () => {
		const html = `
			<main>
				<p class="lead">Important text</p>
			</main>
		`;
		const doc = parseDocument(html);
		const fingerprint = {
			tag: "p",
			attributes: { class: "lead" },
			text: "Important text",
			path: ["html", "body", "main", "p"],
			parent: { tag: "main", attributes: {} },
		};
		const healed = healSelectorMatch(doc, "p.lead", 0.3, fingerprint);
		expect(healed.length).toBeGreaterThanOrEqual(1);
		expect(healed[0].reasons.parent).toBe(1);
	});
});
