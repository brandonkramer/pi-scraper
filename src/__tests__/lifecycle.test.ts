/** @file Pi session lifecycle ownership tests. */
import { readFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EffectiveWebConfig } from "../config.ts";
import type { ModelAdapter, ModelResponse } from "../extract/adhoc/model.ts";
import { registerWebLifecycle, type LifecycleDependencies } from "../lifecycle.ts";
import { modelRegistry } from "../tools/infra/model-registry.ts";

type LifecycleHandler = (event: unknown, context: ExtensionContext) => void | Promise<void>;

function fakeExtensionApi(): {
	pi: ExtensionAPI;
	handlers: Map<string, LifecycleHandler>;
} {
	const handlers = new Map<string, LifecycleHandler>();
	const pi = {
		on(event: string, handler: LifecycleHandler) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers };
}

function fakeContext(notifications: string[]): ExtensionContext {
	return {
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
		},
	} as unknown as ExtensionContext;
}

function fakeAdapter(): ModelAdapter {
	return {
		run: <T>(): Promise<ModelResponse<T>> => Promise.resolve({ data: "ok" as T }),
	};
}

function effectiveConfig(overrides: Partial<EffectiveWebConfig> = {}): EffectiveWebConfig {
	return {
		scrapeMode: "auto",
		outputFormat: "markdown",
		scrapeDefaults: {},
		modelProvider: undefined,
		piAiProvider: undefined,
		piAiModel: undefined,
		...overrides,
	};
}

function dependencies(overrides: Partial<LifecycleDependencies> = {}): LifecycleDependencies {
	return {
		cleanupDownloads: vi.fn(() => Promise.resolve(0)),
		closeBrowsers: vi.fn(() => Promise.resolve()),
		closeStorage: vi.fn(() => Promise.resolve()),
		clearConfigCache: vi.fn(),
		clearManifestCache: vi.fn(),
		loadConfig: vi.fn(() => Promise.resolve(effectiveConfig())),
		createConfiguredAdapter: vi.fn(() => Promise.resolve(undefined)),
		...overrides,
	};
}

beforeEach(() => modelRegistry.clear());
afterEach(() => modelRegistry.clear());

describe("Pi-owned web lifecycle", () => {
	it("does not start cleanup or model work during extension construction", () => {
		const { pi } = fakeExtensionApi();
		const deps = dependencies();

		registerWebLifecycle(pi, deps);

		expect(deps.cleanupDownloads).not.toHaveBeenCalled();
		expect(deps.loadConfig).not.toHaveBeenCalled();
		expect(deps.createConfiguredAdapter).not.toHaveBeenCalled();
	});

	it("starts cache, download, and configured-model work on session_start", async () => {
		const { pi, handlers } = fakeExtensionApi();
		const adapter = fakeAdapter();
		const deps = dependencies({
			loadConfig: vi.fn(() =>
				Promise.resolve(
					effectiveConfig({
						piAiProvider: "anthropic",
						piAiModel: "claude-opus-4-7",
					}),
				),
			),
			createConfiguredAdapter: vi.fn(() => Promise.resolve(adapter)),
		});
		registerWebLifecycle(pi, deps);

		await handlers.get("session_start")?.({}, fakeContext([]));

		expect(deps.clearConfigCache).toHaveBeenCalledOnce();
		expect(deps.clearManifestCache).toHaveBeenCalledOnce();
		expect(deps.cleanupDownloads).toHaveBeenCalledOnce();
		expect(deps.createConfiguredAdapter).toHaveBeenCalledWith({
			provider: "anthropic",
			model: "claude-opus-4-7",
		});
		expect(modelRegistry.get("pi-ai")?.adapter).toBe(adapter);
	});

	it("runs idempotent storage and browser cleanup on session_shutdown", async () => {
		const { pi, handlers } = fakeExtensionApi();
		const deps = dependencies();
		registerWebLifecycle(pi, deps);
		const shutdown = handlers.get("session_shutdown");
		const context = fakeContext([]);

		await Promise.all([shutdown?.({}, context), shutdown?.({}, context)]);

		expect(deps.closeStorage).toHaveBeenCalledOnce();
		expect(deps.closeBrowsers).toHaveBeenCalledOnce();
		expect(deps.clearManifestCache).toHaveBeenCalledOnce();
	});

	it("cleans up each sequential session exactly once", async () => {
		const { pi, handlers } = fakeExtensionApi();
		const deps = dependencies();
		registerWebLifecycle(pi, deps);
		const context = fakeContext([]);
		const start = handlers.get("session_start");
		const shutdown = handlers.get("session_shutdown");

		await start?.({}, context);
		await shutdown?.({}, context);
		await start?.({}, context);
		await shutdown?.({}, context);

		expect(deps.closeStorage).toHaveBeenCalledTimes(2);
		expect(deps.closeBrowsers).toHaveBeenCalledTimes(2);
	});

	it("reports configured-model startup failures without failing session startup", async () => {
		const { pi, handlers } = fakeExtensionApi();
		const notifications: string[] = [];
		const deps = dependencies({
			loadConfig: vi.fn(() =>
				Promise.resolve(effectiveConfig({ piAiProvider: "custom", piAiModel: "missing" })),
			),
			createConfiguredAdapter: vi.fn(() => Promise.reject(new Error("runtime failed"))),
		});
		registerWebLifecycle(pi, deps);

		await expect(
			handlers.get("session_start")?.({}, fakeContext(notifications)),
		).resolves.toBeUndefined();
		expect(notifications).toEqual(["pi-scraper Pi model setup failed: runtime failed"]);
	});

	it("does not install process handlers or exit the host", () => {
		const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

		expect(source).not.toContain("process.once");
		expect(source).not.toContain("process.exit");
	});
});
