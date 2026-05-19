/**
 * @file Tests for web_extract action="summarize" — migrated from web-summarize-* test files.
 *   Covers: host model via ctx, adapter resolution precedence, ModelUsage forwarding, lazy filtered
 *   discover.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, beforeEach } from "vitest";

import type {
	ModelAdapter,
	ModelRequest,
	ModelResponse,
	ModelUsage,
} from "../../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";
import {
	modelRegistry,
	initModelAdapterProtocol,
	type RegisteredAdapter,
} from "../infra/model-registry.ts";
import { createWebExtractTool } from "../web-extract.ts";

const signal = new AbortController().signal;

type HostModel = ExtensionContext["model"];

function fakeScrapeDeps(): ScrapePipelineDeps {
	const html = `<!doctype html><html><head><title>Fixture</title></head><body><main><h1>Fixture Heading</h1><p>Fixture body text.</p></main></body></html>`;
	return {
		httpClient: {
			async fetchUrl() {
				return {
					url: "https://example.com/page",
					finalUrl: "https://example.com/page",
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
					contentType: "text/html; charset=utf-8",
					text: html,
					downloadedBytes: Buffer.byteLength(html),
				};
			},
		},
	};
}

function mockHostModelAdapter(usage?: ModelUsage): unknown {
	return {
		async run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
			return { data: "host-model summary" as T, usage };
		},
	};
}

function makeAdapter(label: string): {
	adapter: { run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> };
	calls: string[];
} {
	const calls: string[] = [];
	return {
		adapter: {
			run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
				calls.push(label);
				return Promise.resolve({ data: `from-${label}` as T });
			},
		},
		calls,
	};
}

function mockAdapter(usage?: ModelUsage): ModelAdapter {
	return {
		async run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
			return { data: "summary text" as T, usage };
		},
	};
}

describe("web_extract action=summarize host model via ctx", () => {
	it("uses ctx.model when no explicit adapter is provided", async () => {
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostModelAdapter() as HostModel },
		);
		expect(result.content[0]?.text).toContain("host-model summary");
	});

	it("forwards usage from host model to envelope", async () => {
		const usage: ModelUsage = {
			provider: "pi-host",
			model: "gpt-4",
			inputTokens: 100,
			outputTokens: 50,
			totalTokens: 150,
		};
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostModelAdapter(usage) as HostModel },
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toEqual(usage);
	});

	it("does not emit MODEL_ADAPTER_MISSING when host model is available", async () => {
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostModelAdapter() as HostModel },
		);
		expect((result.details as { error?: { code: string } }).error).toBeUndefined();
		expect(result.content[0]?.text).toContain("host-model summary");
	});
});

describe("web_extract action=summarize adapter resolution precedence", () => {
	it("options.modelAdapter beats ctx.model", async () => {
		const injected = makeAdapter("injected");
		const host = makeAdapter("host");
		const tool = createWebExtractTool({
			modelAdapter: injected.adapter as unknown as ModelAdapter,
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: host.adapter as unknown as HostModel },
		);
		expect(result.content[0]?.text).toContain("from-injected");
		expect(injected.calls.length).toBe(1);
		expect(host.calls.length).toBe(0);
	});

	it("ctx.model beats event-bus registry", async () => {
		modelRegistry.clear();
		const registered = makeAdapter("registry");
		modelRegistry.register({
			id: "test-registry",
			label: "test",
			capabilities: ["summarize"],
			priority: 100,
			adapter: registered.adapter as unknown as ModelAdapter,
		});
		const host = makeAdapter("host");
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: host.adapter as unknown as HostModel },
		);
		expect(result.content[0]?.text).toContain("from-host");
		expect(registered.calls.length).toBe(0);
		expect(host.calls.length).toBe(1);
	});

	it("event-bus registry beats MODEL_ADAPTER_MISSING", async () => {
		modelRegistry.clear();
		const registered = makeAdapter("registry");
		modelRegistry.register({
			id: "test-registry",
			label: "test",
			capabilities: ["summarize"],
			priority: 100,
			adapter: registered.adapter as unknown as ModelAdapter,
		});
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
		);
		expect(result.content[0]?.text).toContain("from-registry");
		expect(registered.calls.length).toBe(1);
	});
});

describe("web_extract action=summarize ModelUsage forwarding", () => {
	it("forwards full usage to envelope when adapter returns it", async () => {
		const usage: ModelUsage = {
			provider: "gemini-acp",
			model: "gemini-2.0-flash",
			inputTokens: 234,
			outputTokens: 187,
			totalTokens: 421,
			costUSD: 0.0023,
		};
		const tool = createWebExtractTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 3 },
			signal,
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toEqual(usage);
	});

	it("forwards partial usage (tokens but no cost)", async () => {
		const usage: ModelUsage = {
			provider: "ollama",
			inputTokens: 100,
			outputTokens: 50,
		};
		const tool = createWebExtractTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 3 },
			signal,
		);
		const modelUsage = (result.details as { modelUsage?: ModelUsage }).modelUsage;
		expect(modelUsage?.provider).toBe("ollama");
		expect(modelUsage?.inputTokens).toBe(100);
		expect(modelUsage?.outputTokens).toBe(50);
		expect(modelUsage?.costUSD).toBeUndefined();
	});

	it("leaves modelUsage undefined when adapter returns no usage", async () => {
		const tool = createWebExtractTool({
			modelAdapter: mockAdapter(undefined),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 3 },
			signal,
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toBeUndefined();
	});

	it("passes through garbage usage without validation", async () => {
		const usage = {
			provider: "bad-adapter",
			inputTokens: "234" as unknown as number,
		} as ModelUsage;
		const tool = createWebExtractTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 3 },
			signal,
		);
		const modelUsage = (result.details as { modelUsage?: ModelUsage }).modelUsage;
		expect(modelUsage?.provider).toBe("bad-adapter");
		expect(modelUsage?.inputTokens).toBe("234");
	});
});

/** Build a mock Pi whose events honour DiscoverPayload filters. */
type DiscoverHandlers = Map<string, Array<(payload: unknown) => void>>;

function mockPiWithFilteredDiscover() {
	const events: Array<{ event: string; payload: unknown }> = [];
	const handlers: DiscoverHandlers = new Map();
	const pi = {
		events: {
			on(event: string, handler: (payload: unknown) => void) {
				if (!handlers.has(event)) handlers.set(event, []);
				handlers.get(event)!.push(handler);
			},
			emit(event: string, payload: unknown) {
				events.push({ event, payload });
				for (const h of handlers.get(event) ?? []) h(payload);
			},
		},
	};
	return { pi, events, handlers };
}

function fakeRegisteredAdapter(id: string, capabilities: readonly string[]): RegisteredAdapter {
	return {
		id,
		label: id,
		capabilities: capabilities as RegisteredAdapter["capabilities"],
		priority: 50,
		adapter: {
			async run<T>(): Promise<ModelResponse<T>> {
				return { data: `from-${id}` as T };
			},
		},
	};
}

function registerFilteredProvider(
	handlers: DiscoverHandlers,
	providerEntry: RegisteredAdapter,
): void {
	handlers.set("pi:model-adapter/discover", [
		(payload: unknown) => {
			const filter = payload as {
				capabilities?: readonly string[];
			};
			if (matchesDiscoverFilter(providerEntry, filter.capabilities)) {
				modelRegistry.register(providerEntry);
			}
		},
	]);
}

function matchesDiscoverFilter(
	providerEntry: RegisteredAdapter,
	capabilities: readonly string[] | undefined,
): boolean {
	return (
		capabilities === undefined ||
		providerEntry.capabilities.some((capability) => capabilities.includes(capability))
	);
}

describe("web_extract action=summarize lazy filtered discover", () => {
	beforeEach(() => {
		modelRegistry.clear();
	});

	it("triggers filtered discover on first invocation when no adapter is registered", async () => {
		const { pi, events } = mockPiWithFilteredDiscover();
		initModelAdapterProtocol(pi);

		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);

		const discovers = events.filter((e) => e.event === "pi:model-adapter/discover");
		expect(discovers.length).toBeGreaterThanOrEqual(1);
		const lazy = discovers.at(-1);
		expect(lazy?.payload).toEqual({ capabilities: ["summarize"] });
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
	});

	it("lazy discover causes a matching provider to re-register and route", async () => {
		const { pi, events, handlers } = mockPiWithFilteredDiscover();

		const providerEntry = fakeRegisteredAdapter("gemini", ["summarize"]);
		registerFilteredProvider(handlers, providerEntry);

		initModelAdapterProtocol(pi);

		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);

		expect(result.content[0]?.text).toContain("from-gemini");
		const discovers = events.filter((e) => e.event === "pi:model-adapter/discover");
		expect(discovers.length).toBeGreaterThanOrEqual(1);
	});

	it("provider with non-matching capability does not re-register under filtered discover", async () => {
		const { pi, handlers } = mockPiWithFilteredDiscover();

		const providerEntry = fakeRegisteredAdapter("extractor-only", ["extract"]);
		registerFilteredProvider(handlers, providerEntry);

		initModelAdapterProtocol(pi);
		modelRegistry.clear();

		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);

		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
		expect(modelRegistry.list().map((e) => e.id)).toEqual([]);
	});

	it("second invocation does not re-emit discover (cache works)", async () => {
		const { pi, events, handlers } = mockPiWithFilteredDiscover();

		const providerEntry = fakeRegisteredAdapter("gemini", ["summarize"]);
		registerFilteredProvider(handlers, providerEntry);

		initModelAdapterProtocol(pi);

		const tool = createWebExtractTool();
		await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		const discoversAfterFirst = events.filter(
			(e) => e.event === "pi:model-adapter/discover",
		).length;

		await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		const discoversAfterSecond = events.filter(
			(e) => e.event === "pi:model-adapter/discover",
		).length;

		expect(discoversAfterSecond).toBe(discoversAfterFirst);
	});
});
