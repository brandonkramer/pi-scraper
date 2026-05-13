/** @file Scrape **tests** line-filter.test module. */
import { describe, expect, it } from "vitest";

import { filterLines } from "../line-filter.ts";

describe("filterLines", () => {
	it("finds simple matches case-insensitive by default", () => {
		const text = "alpha\nBETA\ngamma";
		const matches = filterLines(text, ["beta"]);
		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({ needle: "beta", line: 2, text: "BETA" });
	});

	it("respects caseSensitive", () => {
		const text = "alpha\nBETA\ngamma";
		const matches = filterLines(text, ["beta"], 0, true);
		expect(matches).toHaveLength(0);
	});

	it("includes context lines", () => {
		const text = "one\ntwo\nthree\nfour\nfive";
		const matches = filterLines(text, ["three"], 1);
		expect(matches[0]?.contextBefore).toEqual([{ line: 2, text: "two" }]);
		expect(matches[0]?.contextAfter).toEqual([{ line: 4, text: "four" }]);
	});

	it("dedupes by needle+line", () => {
		const text = "aaa\naaa";
		const matches = filterLines(text, ["a"]);
		expect(matches).toHaveLength(2);
		expect(matches[0]?.line).toBe(1);
		expect(matches[1]?.line).toBe(2);
	});

	it("handles multiple needles", () => {
		const text = "apple\nbanana\ncherry";
		const matches = filterLines(text, ["a", "b"]);
		expect(matches).toHaveLength(3);
		expect(matches.map((m) => m.needle)).toContain("a");
		expect(matches.map((m) => m.needle)).toContain("b");
	});

	it("returns empty for no matches", () => {
		expect(filterLines("foo\nbar", ["baz"])).toEqual([]);
	});
});
