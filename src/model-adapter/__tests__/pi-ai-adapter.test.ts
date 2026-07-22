/** @file Pi 0.81 model adapter tests. */
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	createPiModelAdapter,
	tryCreatePiAiAdapter,
	type PiModelsClient,
} from "../pi-ai-adapter.ts";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
	process.env = ORIGINAL_ENV;
});

function fakeModel(provider = "anthropic", id = "claude-opus-4-7"): Model<Api> {
	return {
		id,
		name: id,
		api: "test-api",
		provider,
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10_000,
		maxTokens: 1_000,
	};
}

function fakeMessage(
	model: Model<Api>,
	overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "model output" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 12,
			output: 4,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 16,
			cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

function fakeRuntime(
	model = fakeModel(),
	complete = (selected: Model<Api>) => Promise.resolve(fakeMessage(selected)),
): PiModelsClient {
	return {
		getModel(provider, id) {
			return provider === model.provider && id === model.id ? model : undefined;
		},
		completeSimple(selected) {
			return complete(selected);
		},
	};
}

describe("tryCreatePiAiAdapter", () => {
	it("returns undefined when provider/model configuration is incomplete", async () => {
		delete process.env.PI_AI_PROVIDER;
		delete process.env.PI_AI_MODEL;
		const createRuntime = vi.fn(() => Promise.resolve(fakeRuntime()));

		expect(await tryCreatePiAiAdapter(undefined, { createRuntime })).toBeUndefined();
		expect(
			await tryCreatePiAiAdapter({ provider: "anthropic" }, { createRuntime }),
		).toBeUndefined();
		expect(createRuntime).not.toHaveBeenCalled();
	});

	it("resolves the configured model through the current runtime", async () => {
		const createRuntime = vi.fn(() => Promise.resolve(fakeRuntime()));
		const adapter = await tryCreatePiAiAdapter(
			{ provider: "anthropic", model: "claude-opus-4-7" },
			{ createRuntime },
		);

		expect(adapter).toBeDefined();
		expect(createRuntime).toHaveBeenCalledOnce();
		expect(await adapter?.run({ task: "summarize", input: "page" })).toMatchObject({
			data: "model output",
			text: "model output",
			usage: {
				provider: "anthropic/claude-opus-4-7",
				model: "claude-opus-4-7",
				inputTokens: 12,
				outputTokens: 4,
				totalTokens: 16,
				costUSD: 0.03,
			},
		});
	});

	it("uses environment configuration and lets explicit options override it", async () => {
		process.env.PI_AI_PROVIDER = "openai";
		process.env.PI_AI_MODEL = "gpt-env";
		const selected: string[] = [];
		const runtime: PiModelsClient = {
			getModel(provider, id) {
				selected.push(`${provider}/${id}`);
				return fakeModel(provider, id);
			},
			completeSimple(model) {
				return Promise.resolve(fakeMessage(model));
			},
		};
		const createRuntime = () => Promise.resolve(runtime);

		expect(await tryCreatePiAiAdapter(undefined, { createRuntime })).toBeDefined();
		expect(
			await tryCreatePiAiAdapter(
				{ provider: "anthropic", model: "claude-explicit" },
				{ createRuntime },
			),
		).toBeDefined();
		expect(selected).toEqual(["openai/gpt-env", "anthropic/claude-explicit"]);
	});

	it("returns undefined for an unknown model or failed runtime initialization", async () => {
		expect(
			await tryCreatePiAiAdapter(
				{ provider: "missing", model: "missing" },
				{ createRuntime: () => Promise.resolve(fakeRuntime()) },
			),
		).toBeUndefined();
		expect(
			await tryCreatePiAiAdapter(
				{ provider: "anthropic", model: "claude-opus-4-7" },
				{ createRuntime: () => Promise.reject(new Error("runtime failed")) },
			),
		).toBeUndefined();
	});
});

describe("createPiModelAdapter", () => {
	it("forwards the abort signal to Pi and parses extraction JSON", async () => {
		const model = fakeModel();
		const controller = new AbortController();
		let receivedSignal: AbortSignal | undefined;
		let receivedContext: Context | undefined;
		const adapter = createPiModelAdapter(model, (context, signal) => {
			receivedContext = context;
			receivedSignal = signal;
			return Promise.resolve(
				fakeMessage(model, { content: [{ type: "text", text: '{"title":"Pi"}' }] }),
			);
		});

		const result = await adapter.run<{ title: string }>(
			{ task: "extract", input: "# Pi", schema: { title: "string" } },
			controller.signal,
		);
		expect(result.data).toEqual({ title: "Pi" });
		expect(receivedSignal).toBe(controller.signal);
		expect(receivedContext?.messages[0]?.role).toBe("user");
	});

	it("does not start an already-aborted request", async () => {
		const model = fakeModel();
		const complete = vi.fn((_context: Context, _signal?: AbortSignal) =>
			Promise.resolve(fakeMessage(model)),
		);
		const adapter = createPiModelAdapter(model, complete);
		const controller = new AbortController();
		controller.abort();

		await expect(
			adapter.run({ task: "summarize", input: "page" }, controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(complete).not.toHaveBeenCalled();
	});

	it.each([
		["error" as const, "provider failed", "Error"],
		["aborted" as const, "cancelled", "AbortError"],
	])("rejects Pi %s responses", async (stopReason, errorMessage, name) => {
		const model = fakeModel();
		const adapter = createPiModelAdapter(model, () =>
			Promise.resolve(fakeMessage(model, { stopReason, errorMessage })),
		);

		await expect(adapter.run({ task: "summarize", input: "page" })).rejects.toMatchObject({
			name,
			message: errorMessage,
		});
	});

	it("passes signal through the configured runtime client", async () => {
		const model = fakeModel();
		let options: ModelsSimpleStreamOptions | undefined;
		const runtime: PiModelsClient = {
			getModel: () => model,
			completeSimple(_model, _context, receivedOptions) {
				options = receivedOptions;
				return Promise.resolve(fakeMessage(model));
			},
		};
		const adapter = await tryCreatePiAiAdapter(
			{ provider: model.provider, model: model.id },
			{ createRuntime: () => Promise.resolve(runtime) },
		);
		const controller = new AbortController();

		await adapter?.run({ task: "summarize", input: "page" }, controller.signal);
		expect(options?.signal).toBe(controller.signal);
	});
});
