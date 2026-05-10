/**
 * @fileoverview storage __tests__ freshness.test module.
 */
import { describe, expect, it } from "vitest";
import {
	aggregateFreshness,
	freshnessFromTimestamp,
	freshnessMetadata,
} from "../freshness.ts";

describe("freshness metadata", () => {
	it("maps cached fetch rows to explicit freshness fields", () => {
		const freshness = freshnessMetadata(
			"2024-01-01T00:00:00.000Z",
			3_600,
			Date.parse("2024-01-01T00:02:00.000Z"),
			60,
		);

		expect(freshness).toMatchObject({
			cached: true,
			cachedAt: "2024-01-01T00:00:00.000Z",
			fetchedAt: "2024-01-01T00:00:00.000Z",
			ageSeconds: 120,
			maxAgeSeconds: 60,
			stale: true,
		});
	});

	it("aggregates the oldest and stale member", () => {
		const fresh = freshnessFromTimestamp(
			"2024-01-01T00:00:00.000Z",
			300,
			Date.parse("2024-01-01T00:01:00.000Z"),
		);
		const stale = freshnessFromTimestamp(
			"2024-01-01T00:00:00.000Z",
			30,
			Date.parse("2024-01-01T00:02:00.000Z"),
		);

		expect(aggregateFreshness([fresh, stale])).toMatchObject({
			ageSeconds: 120,
			stale: true,
		});
	});
});
