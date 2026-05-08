/**
 * @fileoverview tools __tests__ result.test module.
 */
import { describe, expect, it } from "vitest";
import { progressShell } from "../progress.js";
import { errorResult, toolResult } from "../result.js";

describe("tool result helpers", () => {
	it("builds the standard Pi shell and envelope", () => {
		const result = toolResult({
			text: "ok",
			data: { value: 1 },
			url: "https://example.com",
			mode: "fast",
		});
		expect(result.content).toEqual([{ type: "text", text: "ok" }]);
		expect(result.details.url).toBe("https://example.com");
		expect(result.details.mode).toBe("fast");
		expect(result.details.truncated).toBe(false);
		expect(result.details.data).toEqual({ value: 1 });
	});

	it("passes through agentic synthesis fields", () => {
		const result = toolResult({
			text: "ok",
			data: { value: 1 },
			summary: "Found a reusable scrape.",
			answerContext: "Use the stored content when freshness is acceptable.",
			sourceNotes: [
				{ id: "s1", uri: "https://example.com", excerpt: "Example" },
			],
			qualitySignals: { confidence: "high", freshness: "current" },
			nextActions: [
				{
					action: "inspect",
					tool: "web_crawl",
					params: { action: "status", crawlId: "c1" },
					description: "Inspect crawl status.",
				},
			],
			assistantGuidance: "Answer from answerContext first.",
			diagnostics: { storage: "sqlite" },
		});
		expect(result.details.summary).toBe("Found a reusable scrape.");
		expect(result.details.answerContext).toContain("stored content");
		expect(result.details.sourceNotes?.[0]?.id).toBe("s1");
		expect(result.details.qualitySignals?.confidence).toBe("high");
		expect(result.details.nextActions?.[0]?.tool).toBe("web_crawl");
		expect(result.details.assistantGuidance).toContain("answerContext");
		expect(result.details.diagnostics?.storage).toBe("sqlite");
	});

	it("derives freshness metadata and stale guidance from cached inputs", () => {
		const result = toolResult({
			text: "cached",
			data: { value: 1 },
			cache: {
				cached: true,
				cachedAt: "2024-01-01T00:00:00.000Z",
				fetchedAt: "2024-01-01T00:00:00.000Z",
				ageSeconds: 120,
				maxAgeSeconds: 60,
				stale: true,
			},
			assistantGuidance: "Use answerContext first.",
		});

		expect(result.details.freshness).toMatchObject({
			cachedAt: "2024-01-01T00:00:00.000Z",
			maxAgeSeconds: 60,
			stale: true,
		});
		expect(result.details.assistantGuidance).toContain("may be stale");
	});

	it("builds structured error shells", () => {
		const result = errorResult({
			code: "NOPE",
			phase: "test",
			message: "Nope",
			retryable: false,
		});
		expect(result.details.error?.code).toBe("NOPE");
		expect(result.content[0]?.text).toBe("Nope");
	});
});

describe("progressShell", () => {
	it("marks progress details", () => {
		const progress = progressShell({
			state: "processing",
			current: 1,
			total: 3,
			url: "https://example.com",
		});
		expect(progress.details._progress).toBe(true);
		expect(progress.details.state).toBe("processing");
		expect(progress.content[0]?.text).toContain("1/3");
	});
});
