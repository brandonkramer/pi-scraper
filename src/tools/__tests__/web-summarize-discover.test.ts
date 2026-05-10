/**
 * @fileoverview web-summarize-discover __tests__ module.
 *
 * Tests lazy capability-filtered discover in web_summarize.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createWebSummarizeTool } from "../web-summarize.ts";
import {
	modelRegistry,
	initModelAdapterProtocol,
	type RegisteredAdapter,
} from "../infra/model-registry.ts";

const signal = new AbortController().signal;

function fakeRegisteredAdapter(
	id: string,
	capabilities: readonly string[],
): RegisteredAdapter {
	return {
		id,
		label: id,
		capabilities: capabilities as RegisteredAdapter["capabilities"],
		priority: 50,
		adapter: {
			async run<T>() {
				return { data: `from-${id}` as T };
			},
		},
	};
}

/** Build a mock Pi whose events honour DiscoverPayload filters. */
function mockPiWithFilteredDiscover() {
	const events: Array<{ event: string; payload: unknown }> = [];
	const handlers = new Map<string, Array<(payload: unknown) => void>>();
	const pi = {
		events: {
			on(event: string, handler: (payload: unknown) => void) {
				if (!handlers.has(event)) handlers.set(event, []);
				handlers.get(event)!.push(handler);
			},
			emit(event: string, payload: unknown) {
				events.push({ event, payload });
				handlers.get(event)?.forEach((h) => h(payload));
			},
		},
	};
	return { pi, events, handlers };
}

describe("web_summarize lazy filtered discover", () => {
	beforeEach(() => {
		modelRegistry.clear();
	});

	it("triggers filtered discover on first invocation when no adapter is registered", async () => {
		const { pi, events } = mockPiWithFilteredDiscover();
		initModelAdapterProtocol(pi);

		const tool = createWebSummarizeTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", sentences: 1 },
			signal,
			undefined,
			{ getFlag: () => undefined },
		);

		// First init-time discover ({}), then lazy filtered discover
		const discovers = events.filter(
			(e) => e.event === "pi:model-adapter/discover",
		);
		expect(discovers.length).toBeGreaterThanOrEqual(1);
		const lazy = discovers[discovers.length - 1];
		expect(lazy?.payload).toEqual({ capabilities: ["summarize"] });
		expect((result.details as { error?: { code: string } }).error?.code).toBe("MODEL_ADAPTER_MISSING");
	});

	it("lazy discover causes a matching provider to re-register and route", async () => {
		const { pi, events, handlers } = mockPiWithFilteredDiscover();

		// Register a provider that honours the discover filter
		const providerEntry = fakeRegisteredAdapter("gemini", ["summarize"]);
		handlers.set("pi:model-adapter/discover", [
			(payload: unknown) => {
				const filter = payload as {
					capabilities?: readonly string[];
				};
				if (
					!filter.capabilities ||
					providerEntry.capabilities.some((c) =>
						filter.capabilities!.includes(c),
					)
				) {
					modelRegistry.register(providerEntry);
				}
			},
		]);

		initModelAdapterProtocol(pi);

		const tool = createWebSummarizeTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", sentences: 1 },
			signal,
			undefined,
			{ getFlag: () => undefined },
		);

		expect(result.content[0]?.text).toContain("from-gemini");
		const discovers = events.filter(
			(e) => e.event === "pi:model-adapter/discover",
		);
		expect(discovers.length).toBeGreaterThanOrEqual(1);
	});

	it("provider with non-matching capability does not re-register under filtered discover", async () => {
		const { pi, handlers } = mockPiWithFilteredDiscover();

		const providerEntry = fakeRegisteredAdapter("chatbot", ["chat" as string]);
		handlers.set("pi:model-adapter/discover", [
			(payload: unknown) => {
				const filter = payload as {
					capabilities?: readonly string[];
				};
				if (
					!filter.capabilities ||
					providerEntry.capabilities.some((c) =>
						filter.capabilities!.includes(c),
					)
				) {
					modelRegistry.register(providerEntry);
				}
			},
		]);

		initModelAdapterProtocol(pi);
		// Init-time discover (payload {}) registers all providers.
		// Clear registry to isolate the lazy-filtered-discover effect.
		modelRegistry.clear();

		const tool = createWebSummarizeTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", sentences: 1 },
			signal,
			undefined,
			{ getFlag: () => undefined },
		);

		expect((result.details as { error?: { code: string } }).error?.code).toBe("MODEL_ADAPTER_MISSING");
		expect(modelRegistry.list().map((e) => e.id)).toEqual([]);
	});

	it("second invocation does not re-emit discover (cache works)", async () => {
		const { pi, events, handlers } = mockPiWithFilteredDiscover();

		const providerEntry = fakeRegisteredAdapter("gemini", ["summarize"]);
		handlers.set("pi:model-adapter/discover", [
			(payload: unknown) => {
				const filter = payload as {
					capabilities?: readonly string[];
				};
				if (
					!filter.capabilities ||
					providerEntry.capabilities.some((c) =>
						filter.capabilities!.includes(c),
					)
				) {
					modelRegistry.register(providerEntry);
				}
			},
		]);

		initModelAdapterProtocol(pi);

		const tool = createWebSummarizeTool();
		// First call
		await tool.execute(
			"call",
			{ content: "page text", sentences: 1 },
			signal,
			undefined,
			{ getFlag: () => undefined },
		);
		const discoversAfterFirst = events.filter(
			(e) => e.event === "pi:model-adapter/discover",
		).length;

		// Second call
		await tool.execute(
			"call",
			{ content: "page text", sentences: 1 },
			signal,
			undefined,
			{ getFlag: () => undefined },
		);
		const discoversAfterSecond = events.filter(
			(e) => e.event === "pi:model-adapter/discover",
		).length;

		expect(discoversAfterSecond).toBe(discoversAfterFirst);
	});
});
