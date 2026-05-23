/* oxlint-disable vitest/no-conditional-in-test, vitest/no-conditional-expect -- pi-ai is peer-optional; test must short-circuit when not installed */
/** @file Pi-ai-adapter **tests** module. */
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { ModelResponse } from "../../extract/adhoc/model.ts";
import { tryCreatePiAiAdapter } from "../pi-ai-adapter.ts";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
	process.env = ORIGINAL_ENV;
});

describe("tryCreatePiAiAdapter", () => {
	it("returns undefined when env and opts are empty", async () => {
		delete process.env.PI_AI_PROVIDER;
		delete process.env.PI_AI_MODEL;
		const adapter = await tryCreatePiAiAdapter();
		expect(adapter).toBeUndefined();
	});

	it("returns undefined when only provider set", async () => {
		process.env.PI_AI_PROVIDER = "anthropic";
		delete process.env.PI_AI_MODEL;
		const adapter = await tryCreatePiAiAdapter();
		expect(adapter).toBeUndefined();
	});

	it("returns undefined when only model set", async () => {
		delete process.env.PI_AI_PROVIDER;
		process.env.PI_AI_MODEL = "claude-opus-4-7";
		const adapter = await tryCreatePiAiAdapter();
		expect(adapter).toBeUndefined();
	});

	it("returns adapter when provider+model set via opts", async () => {
		const adapter = await tryCreatePiAiAdapter({
			provider: "anthropic",
			model: "claude-opus-4-7",
		});
		// pi-ai may or may not be installed in the test environment
		// The key behavior is no exception thrown + returns ModelAdapter | undefined
		if (adapter) {
			expect(typeof adapter.run).toBe("function");
		}
	});

	it("uses env vars when opts not provided", async () => {
		process.env.PI_AI_PROVIDER = "anthropic";
		process.env.PI_AI_MODEL = "claude-opus-4-7";
		const adapter = await tryCreatePiAiAdapter();
		if (adapter) {
			expect(typeof adapter.run).toBe("function");
		}
	});

	it("opts override env vars", async () => {
		process.env.PI_AI_PROVIDER = "openai";
		process.env.PI_AI_MODEL = "gpt-4o";
		const adapter = await tryCreatePiAiAdapter({
			provider: "anthropic",
			model: "claude-opus-4-7",
		});
		if (adapter) {
			expect(typeof adapter.run).toBe("function");
		}
	});

	it("run method returns ModelResponse with correct shape for summarize", async () => {
		const adapter = await tryCreatePiAiAdapter({
			provider: "anthropic",
			model: "claude-opus-4-7",
		});
		// pi-ai not installed — skip
		if (!adapter) return;
		const result = await adapter.run({
			task: "summarize",
			input: "Some content to summarize.",
			prompt: "Summarize this briefly.",
		});
		expect(result).toHaveProperty("data");
		expect(result).toHaveProperty("text");
		expect(result).toHaveProperty("raw");
		expect(typeof result.text).toBe("string");
	});

	it("run method returns ModelResponse with correct shape for extract", async () => {
		const adapter = await tryCreatePiAiAdapter({
			provider: "anthropic",
			model: "claude-opus-4-7",
		});
		if (!adapter) return;
		const result = await adapter.run({
			task: "extract",
			input: '{"name": "test"}',
			schema: { properties: { name: { type: "string" } } },
		});
		expect(result).toHaveProperty("data");
		expect(result).toHaveProperty("text");
	});

	it("honors abort signal", async () => {
		const adapter = await tryCreatePiAiAdapter({
			provider: "anthropic",
			model: "claude-opus-4-7",
		});
		if (!adapter) return;
		const controller = new AbortController();
		controller.abort();
		await expect(
			adapter.run({ task: "summarize", input: "x" }, controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("run returns usage with provider and model", async () => {
		const adapter = await tryCreatePiAiAdapter({
			provider: "anthropic",
			model: "claude-opus-4-7",
		});
		if (!adapter) return;
		const result: ModelResponse = await adapter.run({
			task: "summarize",
			input: "Test",
		});
		expect(result.usage?.provider).toBe("anthropic/claude-opus-4-7");
		expect(result.usage?.model).toBe("claude-opus-4-7");
	});
});
