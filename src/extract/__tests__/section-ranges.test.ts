/**
 * @fileoverview Tests for deterministic section-range extraction.
 */
import { describe, expect, it } from "vitest";
import { inspectPatterns } from "../pattern.js";

describe("inspectPatterns sections", () => {
	it("extracts content between start and end markers", async () => {
		const result = await inspectPatterns({
			content: "# Guide\n\n## Install\nRun npm install.\n\n## Usage\nRun it.",
			sections: [{ name: "install", start: "## Install", end: "## Usage" }],
		});

		expect(result.sections).toEqual([
			expect.objectContaining({
				name: "install",
				found: true,
				endFound: true,
				text: "## Install\nRun npm install.\n\n",
			}),
		]);
	});

	it("can omit start marker and include the end marker", async () => {
		const result = await inspectPatterns({
			content: "alpha START beta END gamma",
			sections: [
				{
					start: "START",
					end: "END",
					includeStart: false,
					includeEnd: true,
				},
			],
		});

		expect(result.sections?.[0]?.text).toBe(" beta END");
	});

	it("reports missing markers without throwing", async () => {
		const result = await inspectPatterns({
			content: "no matching heading",
			sections: [{ start: "## Missing", end: "## Next" }],
		});

		expect(result.sections?.[0]).toMatchObject({
			found: false,
			endFound: false,
			startIndex: -1,
		});
	});

	it("rejects invalid section requests as pattern input errors", async () => {
		await expect(
			inspectPatterns({ content: "text", sections: [{ start: "" }] }),
		).rejects.toMatchObject({
			name: "PatternInspectError",
			structured: { code: "PATTERN_INPUT_INVALID" },
		});
	});
});
