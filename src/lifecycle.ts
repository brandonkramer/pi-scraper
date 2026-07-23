/** @file Pi-owned startup and shutdown for pi-scraper resources. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { closeAllBrowserSessions } from "./browser/session-pool.ts";
import {
	clearEffectiveConfigCache,
	loadEffectiveConfig,
	type EffectiveWebConfig,
} from "./config.ts";
import type { ModelAdapter } from "./extract/adhoc/model.ts";
import { clearManifestRegistryCache } from "./extract/vertical/manifest-registry.ts";
import { cleanupOldDownloads } from "./http/download-storage.ts";
import { tryCreatePiAiAdapter, type PiAiAdapterOptions } from "./model-adapter/pi-ai-adapter.ts";
import { closeStorageDbs } from "./storage/db/open.ts";
import { modelRegistry } from "./tools/infra/model-registry.ts";

export interface LifecycleDependencies {
	cleanupDownloads: () => Promise<number>;
	closeBrowsers: () => Promise<void>;
	closeStorage: () => Promise<void>;
	clearConfigCache: () => void;
	clearManifestCache: () => void;
	loadConfig: () => Promise<EffectiveWebConfig>;
	createConfiguredAdapter: (
		options: Partial<PiAiAdapterOptions>,
	) => Promise<ModelAdapter | undefined>;
}

const defaultDependencies: LifecycleDependencies = {
	cleanupDownloads: () => cleanupOldDownloads(),
	closeBrowsers: closeAllBrowserSessions,
	closeStorage: closeStorageDbs,
	clearConfigCache: clearEffectiveConfigCache,
	clearManifestCache: clearManifestRegistryCache,
	loadConfig: loadEffectiveConfig,
	createConfiguredAdapter: (options) => tryCreatePiAiAdapter(options),
};

export function registerWebLifecycle(
	pi: ExtensionAPI,
	overrides: Partial<LifecycleDependencies> = {},
): void {
	const dependencies = { ...defaultDependencies, ...overrides };
	let shutdownPromise: Promise<void> | undefined;

	pi.on("session_start", async (_event, context) => {
		if (shutdownPromise) await shutdownPromise;
		shutdownPromise = undefined;
		dependencies.clearConfigCache();
		dependencies.clearManifestCache();
		await startSessionResources(context, dependencies);
	});

	pi.on("session_shutdown", async () => {
		shutdownPromise ??= shutdownSessionResources(dependencies);
		await shutdownPromise;
	});
}

async function startSessionResources(
	context: ExtensionContext,
	dependencies: LifecycleDependencies,
): Promise<void> {
	await dependencies.cleanupDownloads().catch((error: unknown) => {
		notifyLifecycleError(context, "download cleanup", error);
		return 0;
	});

	modelRegistry.unregister("pi-ai");
	let config: EffectiveWebConfig;
	try {
		config = await dependencies.loadConfig();
	} catch (error) {
		notifyLifecycleError(context, "configuration load", error);
		return;
	}

	const provider = config.piAiProvider ?? process.env.PI_AI_PROVIDER;
	const model = config.piAiModel ?? process.env.PI_AI_MODEL;
	if (!provider || !model) return;
	let adapter: ModelAdapter | undefined;
	try {
		adapter = await dependencies.createConfiguredAdapter({ provider, model });
	} catch (error) {
		notifyLifecycleError(context, "Pi model setup", error);
		return;
	}
	if (!adapter) {
		context.ui.notify(
			`pi-scraper could not resolve configured Pi model ${provider}/${model}.`,
			"warning",
		);
		return;
	}
	modelRegistry.register({
		id: "pi-ai",
		label: `Pi runtime (${provider}/${model})`,
		capabilities: ["summarize", "extract"],
		priority: 30,
		adapter,
	});
}

async function shutdownSessionResources(dependencies: LifecycleDependencies): Promise<void> {
	modelRegistry.unregister("pi-ai");
	dependencies.clearManifestCache();
	await Promise.allSettled([dependencies.closeStorage(), dependencies.closeBrowsers()]);
}

function notifyLifecycleError(context: ExtensionContext, operation: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	context.ui.notify(`pi-scraper ${operation} failed: ${message}`, "warning");
}
