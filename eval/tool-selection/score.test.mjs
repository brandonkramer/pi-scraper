/**
 * @fileoverview Unit test for the pure tool-selection scorer. Feeds canned
 * predictions (no model, no network) and asserts the gate flips on a wrong
 * discriminator arg and on a token-budget breach (task 79, convention 3).
 */
import { describe, expect, it } from "vitest";

import { buildReport, gateFailures } from "./score.mjs";

const leanContracts = [
	{
		name: "web_scrape",
		label: "Scrape",
		description: "Fetch one URL page.",
		parameters: { type: "object", properties: { url: { type: "string" } } },
	},
];

const fixtures = [
	{
		id: "s1",
		prompt: "Scrape https://example.com as markdown.",
		expectedTool: "web_scrape",
		expectedArgs: { format: "markdown" },
		tags: ["scrape"],
	},
];

const correct = [{ id: "s1", actualTool: "web_scrape", actualArgs: { format: "markdown" } }];

const score = (contracts, predictions) =>
	buildReport({ contracts, fixtures, predictions, predictionMode: "static-fixture-baseline" });

describe("tool-selection score", () => {
	it("passes the gate on correct tool + discriminator", () => {
		const report = score(leanContracts, correct);
		expect(report.metrics.positiveAccuracy).toBe(1);
		expect(report.metrics.invocationAccuracy).toBe(1);
		expect(report.metrics.criticalConfusions).toBe(0);
		expect(gateFailures(report)).toEqual([]);
	});

	it("flips the gate when a discriminator arg is wrong", () => {
		const wrong = [{ id: "s1", actualTool: "web_scrape", actualArgs: { format: "text" } }];
		const report = score(leanContracts, wrong);
		expect(report.metrics.positiveAccuracy).toBe(1); // tool right
		expect(report.metrics.invocationAccuracy).toBe(0); // arg wrong
		expect(gateFailures(report).join(" ")).toMatch(/invocation arg accuracy/u);
	});

	it("flips the gate when contracts breach the token budget", () => {
		const bloated = [{ ...leanContracts[0], description: "z".repeat(5000) }];
		const report = score(bloated, correct);
		expect(report.contractTokenEstimate).toBeGreaterThan(report.thresholds.contractTokenBudget);
		const failures = gateFailures(report);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatch(/contract tokens/u);
	});
});
