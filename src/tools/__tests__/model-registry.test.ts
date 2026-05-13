/** @file Model-registry **tests** module. */
import { describe, expect, it, beforeEach } from "vitest";

import type { ModelResponse } from "../../extract/adhoc/model.ts";
import { resolveProviderPreference } from "../infra/model-adapter.ts";
import {
	ModelRegistry,
	validateAdapterPayload,
	initModelAdapterProtocol,
	requestAdapterDiscovery,
	type RegisteredAdapter,
} from "../infra/model-registry.ts";

function fakeAdapter(id: string): RegisteredAdapter {
	return {
		id,
		label: `Adapter ${id}`,
		capabilities: ["summarize", "extract"],
		priority: 50,
		adapter: {
			async run<T>(_req: unknown, _signal?: unknown): Promise<ModelResponse<T>> {
				return { data: id as T };
			},
		},
	};
}

describe("ModelRegistry", () => {
	let registry: ModelRegistry;

	beforeEach(() => {
		registry = new ModelRegistry();
	});

	it("registers and lists adapters", () => {
		registry.register(fakeAdapter("a"));
		expect(registry.list().map((e) => e.id)).toEqual(["a"]);
	});

	it("unregisters adapters", () => {
		registry.register(fakeAdapter("a"));
		registry.unregister("a");
		expect(registry.list()).toEqual([]);
	});

	it("resolves auto by priority", async () => {
		registry.register({ ...fakeAdapter("low"), priority: 10 });
		registry.register({ ...fakeAdapter("high"), priority: 90 });
		const resolved = registry.resolve("auto", "summarize")!;
		const result = await resolved.run({ task: "summarize", input: "" });
		expect(result.data).toBe("high");
	});

	it("resolves auto by registration order on tie", async () => {
		registry.register(fakeAdapter("first"));
		registry.register(fakeAdapter("second"));
		const resolved = registry.resolve("auto", "summarize")!;
		const result = await resolved.run({ task: "summarize", input: "" });
		expect(result.data).toBe("first");
	});

	it("returns undefined for auto when no adapter matches capability", () => {
		registry.register({ ...fakeAdapter("a"), capabilities: ["extract"] });
		expect(registry.resolve("auto", "summarize")).toBeUndefined();
	});

	it("returns undefined for explicit id when not registered", () => {
		expect(registry.resolve("missing", "summarize")).toBeUndefined();
	});

	it("returns undefined when explicit id lacks capability", () => {
		registry.register({ ...fakeAdapter("a"), capabilities: ["extract"] });
		expect(registry.resolve("a", "summarize")).toBeUndefined();
	});

	it("get returns entry by id", () => {
		const entry = fakeAdapter("a");
		registry.register(entry);
		expect(registry.get("a")?.id).toBe("a");
	});

	it("get returns undefined for missing id", () => {
		expect(registry.get("missing")).toBeUndefined();
	});

	it("returns undefined for off", () => {
		registry.register(fakeAdapter("a"));
		expect(registry.resolve("off", "summarize")).toBeUndefined();
	});

	it("resolves explicit id when capable", async () => {
		registry.register(fakeAdapter("a"));
		const resolved = registry.resolve("a", "summarize");
		expect(resolved).toBeDefined();
		const result = await resolved!.run({ task: "summarize", input: "" });
		expect(result.data).toBe("a");
	});
});

describe("validateAdapterPayload", () => {
	it("accepts well-formed payloads", () => {
		const entry = validateAdapterPayload({
			id: "test",
			label: "Test",
			capabilities: ["summarize"],
			priority: 50,
			adapter: {
				async run() {
					return { data: true };
				},
			},
		});
		expect(entry).toBeTruthy();
		expect(entry?.id).toBe("test");
	});

	it("rejects missing id", () => {
		expect(
			validateAdapterPayload({
				label: "Test",
				capabilities: ["summarize"],
				priority: 50,
				adapter: { run: () => ({}) },
			}),
		).toBeNull();
	});

	it("rejects non-array capabilities", () => {
		expect(
			validateAdapterPayload({
				id: "test",
				label: "Test",
				capabilities: "summarize",
				priority: 50,
				adapter: { run: () => ({}) },
			}),
		).toBeNull();
	});

	it("rejects adapter without run function", () => {
		expect(
			validateAdapterPayload({
				id: "test",
				label: "Test",
				capabilities: ["summarize"],
				priority: 50,
				adapter: {},
			}),
		).toBeNull();
	});

	it("filters unknown capabilities", () => {
		const entry = validateAdapterPayload({
			id: "test",
			label: "Test",
			capabilities: ["summarize", "unknown"],
			priority: 50,
			adapter: { run: () => ({}) },
		});
		expect(entry?.capabilities).toEqual(["summarize"]);
	});
});

describe("initModelAdapterProtocol", () => {
	it("registers handlers and emits discover", () => {
		const events: Array<{ event: string; payload: unknown }> = [];
		const pi = {
			events: {
				on(event: string, _handler: (payload: unknown) => void) {
					events.push({ event, payload: null });
				},
				emit(event: string, payload: unknown) {
					events.push({ event, payload });
				},
			},
		};
		initModelAdapterProtocol(pi);
		expect(events.map((e) => e.event)).toContain("pi:model-adapter/discover");
	});

	it("ignores registrars without events", () => {
		expect(() => initModelAdapterProtocol({})).not.toThrow();
	});
});

describe("resolveProviderPreference", () => {
	it("trims whitespace from preference values", () => {
		expect(
			resolveProviderPreference({
				paramProvider: "  ollama  ",
				capability: "summarize",
			}),
		).toBe("ollama");
	});

	it("treats whitespace-only preference as empty and falls through", () => {
		expect(
			resolveProviderPreference({
				paramProvider: "   ",
				configProvider: "ollama",
				capability: "summarize",
			}),
		).toBe("ollama");
	});
});

describe("requestAdapterDiscovery", () => {
	it("emits discover with {} when no filter passed", () => {
		const emitted: Array<{ event: string; payload: unknown }> = [];
		const pi = {
			events: {
				emit(event: string, payload: unknown) {
					emitted.push({ event, payload });
				},
			},
		};
		requestAdapterDiscovery(pi);
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.event).toBe("pi:model-adapter/discover");
		expect(emitted[0]?.payload).toEqual({});
	});

	it("emits discover with capability filter", () => {
		const emitted: Array<{ event: string; payload: unknown }> = [];
		const pi = {
			events: {
				emit(event: string, payload: unknown) {
					emitted.push({ event, payload });
				},
			},
		};
		requestAdapterDiscovery(pi, { capabilities: ["summarize"] });
		expect(emitted[0]?.payload).toEqual({ capabilities: ["summarize"] });
	});

	it("emits discover with minPriority filter", () => {
		const emitted: Array<{ event: string; payload: unknown }> = [];
		const pi = {
			events: {
				emit(event: string, payload: unknown) {
					emitted.push({ event, payload });
				},
			},
		};
		requestAdapterDiscovery(pi, { minPriority: 50 });
		expect(emitted[0]?.payload).toEqual({ minPriority: 50 });
	});

	it("is a no-op when pi.events is missing", () => {
		expect(() => requestAdapterDiscovery({})).not.toThrow();
	});
});
