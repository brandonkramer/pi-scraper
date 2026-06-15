/** @file Tests for declarative recursive JSON walk rules. */
import { describe, expect, it } from "vitest";

import { evaluateJsonWalkRule } from "../../vertical/json-walk.ts";

describe("json walk rules", () => {
	it("collects nested projected objects with transforms and dedupe", () => {
		const payload = {
			items: [
				{
					commentRenderer: {
						authorText: { simpleText: "Ada" },
						contentText: { runs: [{ text: "Great" }, { text: " video" }] },
					},
				},
				{
					commentRenderer: {
						authorText: { simpleText: "Ada" },
						contentText: { simpleText: "Great video" },
					},
				},
			],
		};

		const result = evaluateJsonWalkRule(payload, {
			collect: [
				{
					walkObjects: {
						when: { has: "commentRenderer" },
						emit: {
							author: { path: "commentRenderer.authorText", transform: "runsText" },
							text: { path: "commentRenderer.contentText", transform: "runsText" },
						},
					},
				},
			],
			dedupeBy: ["author", "text"],
		});

		expect(result).toEqual([{ author: "Ada", text: "Great video" }]);
	});

	it("finds first recursive value while preferring matching strings", () => {
		const result = evaluateJsonWalkRule(
			{
				first: { continuationCommand: { token: "token-other" } },
				second: { continuationCommand: { token: "token-comments-section" } },
			},
			{
				walkObjects: {
					first: {
						path: "continuationCommand.token",
						preferIncludes: "comments-section",
					},
				},
			},
		);

		expect(result).toBe("token-comments-section");
	});
});
