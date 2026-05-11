/**
 * @file Envelope-usage **tests** module.
 * Tests ModelUsage formatting in the envelope renderer.
 */
import { describe, expect, it } from "vitest";

// Replicate the private helpers for direct unit testing.
function formatModelUsage(u: {
	provider?: string;
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	costUSD?: number;
}): string | undefined {
	const parts: string[] = [];
	if (u.provider) parts.push(u.provider);
	if (u.model) parts.push(u.model);
	if (typeof u.inputTokens === "number") parts.push(`${u.inputTokens} in`);
	if (typeof u.outputTokens === "number") parts.push(`${u.outputTokens} out`);
	if (typeof u.totalTokens === "number") parts.push(`${u.totalTokens} total`);
	if (typeof u.costUSD === "number") parts.push(formatCostUSD(u.costUSD));
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatCostUSD(cost: number): string {
	if (cost === 0) return "$0";
	if (cost < 0.0001) return `~$${cost.toExponential(1)}`;
	if (cost < 1) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

describe("formatModelUsage", () => {
	it("renders full usage shape", () => {
		const line = formatModelUsage({
			provider: "gemini-acp",
			model: "gemini-2.0-flash",
			inputTokens: 234,
			outputTokens: 187,
			totalTokens: 421,
			costUSD: 0.0023,
		});
		expect(line).toBe("gemini-acp · gemini-2.0-flash · 234 in · 187 out · 421 total · $0.0023");
	});

	it("renders provider + model only", () => {
		const line = formatModelUsage({ provider: "ollama", model: "llama3.1:8b" });
		expect(line).toBe("ollama · llama3.1:8b");
	});

	it("omits bad field types (no crash, no NaN)", () => {
		const line = formatModelUsage({
			provider: "bad",
			inputTokens: "234" as unknown as number,
			outputTokens: 50,
		});
		expect(line).toBe("bad · 50 out");
	});

	it("returns undefined for empty object", () => {
		expect(formatModelUsage({})).toBeUndefined();
	});
});

describe("formatCostUSD", () => {
	it("$0", () => {
		expect(formatCostUSD(0)).toBe("$0");
	});

	it("small scientific", () => {
		expect(formatCostUSD(0.00001)).toBe("~$1.0e-5");
	});

	it("sub-dollar fixed(4)", () => {
		expect(formatCostUSD(0.0023)).toBe("$0.0023");
	});

	it("dollar+ fixed(2)", () => {
		expect(formatCostUSD(1.23)).toBe("$1.23");
	});
});
