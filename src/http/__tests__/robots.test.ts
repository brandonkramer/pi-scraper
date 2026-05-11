/** @file Http **tests** robots.test module. */
import { describe, expect, it } from "vitest";

import { RobotsCache } from "../robots.ts";

describe("RobotsCache", () => {
	it("does not cache aborted robots fetches", async () => {
		const scenario = cacheForSequentialRobotsResponses([
			new DOMException("cancelled", "AbortError"),
			{ status: 200, text: "User-agent: *\nDisallow: /blocked" },
		]);

		await expect(scenario.cache.rulesFor("https://example.com/allowed")).rejects.toThrow(
			"cancelled",
		);
		const rules = await scenario.cache.rulesFor("https://example.com/blocked");

		expect(scenario.calls()).toBe(2);
		expect(rules.isAllowed("https://example.com/blocked")).toBe(false);
	});

	it("does not permanently cache fallback rules from failed robots fetches", async () => {
		const scenario = cacheForSequentialRobotsResponses([
			new Error("network failed"),
			{ status: 200, text: "User-agent: *\nDisallow: /blocked" },
		]);

		const fallback = await scenario.cache.rulesFor("https://example.com/blocked");
		const retried = await scenario.cache.rulesFor("https://example.com/blocked");

		expect(scenario.calls()).toBe(2);
		expect(fallback.isAllowed("https://example.com/blocked")).toBe(true);
		expect(retried.isAllowed("https://example.com/blocked")).toBe(false);
	});

	it("treats 5xx robots responses as temporary fail-closed rules", async () => {
		const scenario = cacheForSequentialRobotsResponses([
			{ status: 503, text: "temporarily unavailable" },
			{ status: 200, text: "User-agent: *\nAllow: /recovered" },
		]);

		const temporaryFailure = await scenario.cache.rulesFor("https://example.com/recovered");
		const recovered = await scenario.cache.rulesFor("https://example.com/recovered");

		expect(scenario.calls()).toBe(2);
		expect(temporaryFailure.isAllowed("https://example.com/recovered")).toBe(false);
		expect(recovered.isAllowed("https://example.com/recovered")).toBe(true);
	});
});

type RobotsResponse = { status: number; text: string };
type RobotsOutcome = RobotsResponse | Error | DOMException;

function cacheForSequentialRobotsResponses(outcomes: RobotsOutcome[]): {
	cache: RobotsCache;
	calls: () => number;
} {
	let calls = 0;
	return {
		cache: new RobotsCache({
			fetchText: async () => {
				const outcome = outcomes[calls];
				calls += 1;
				if (outcome instanceof Error || outcome instanceof DOMException) {
					throw outcome;
				}
				return outcome;
			},
		}),
		calls: () => calls,
	};
}
