/** @file Scrape render tests. */
import { describe, expect, it } from "vitest";

import { renderFormat } from "../render.ts";

describe("renderFormat", () => {
	it("does not materialize json for ax-tree output", () => {
		const rendered = renderFormat("ax-tree", {
			text: '- heading "Example"',
			json: { shouldNotLeak: true },
		});

		expect(rendered).toEqual({ text: '- heading "Example"' });
		expect(Object.hasOwn(rendered, "json")).toBe(false);
	});
});
