/** @file Tools model-adapter module. */
import type { ModelAdapter } from "../../extract/adhoc/model.ts";
import {
	createPiHostModelAdapter,
	type PiHostModelContext,
} from "../../model-adapter/pi-ai-adapter.ts";
import { isUnknownRecord } from "../../types.ts";
import { modelRegistry, type ModelCapability, type ResolvePreference } from "./model-registry.ts";

/**
 * Resolve the active Pi 0.81 model through its authenticated provider. No completion methods are
 * inferred from model metadata.
 */
export function resolveModelAdapterFromContext(source?: unknown): ModelAdapter | undefined {
	if (!isPiModelContext(source)) return undefined;
	return createPiHostModelAdapter({ model: source.model, modelRegistry: source.modelRegistry });
}

function isPiModelContext(
	value: unknown,
): value is PiHostModelContext & { model: NonNullable<PiHostModelContext["model"]> } {
	if (!isUnknownRecord(value) || !isUnknownRecord(value.model)) return false;
	const registry = value.modelRegistry;
	return (
		isUnknownRecord(registry) &&
		typeof registry.getProvider === "function" &&
		typeof registry.getApiKeyAndHeaders === "function"
	);
}

/** Resolve a model adapter from the cross-extension registry. */
export function resolveAdapterFromRegistry(
	preference: ResolvePreference,
	capability: ModelCapability,
): ModelAdapter | undefined {
	return modelRegistry.resolve(preference, capability);
}

/** Resolve the user preference without letting the ambient Pi model bypass `off` or an explicit id. */
export function resolvePreferredModelAdapter(options: {
	explicitAdapter?: ModelAdapter;
	context?: unknown;
	preference: ResolvePreference;
	capability: ModelCapability;
}): ModelAdapter | undefined {
	if (options.explicitAdapter) return options.explicitAdapter;
	if (options.preference === "off") return undefined;
	if (options.preference !== "auto") {
		return resolveAdapterFromRegistry(options.preference, options.capability);
	}
	return (
		resolveModelAdapterFromContext(options.context) ??
		resolveAdapterFromRegistry("auto", options.capability)
	);
}

/**
 * Resolve provider preference from the precedence chain: per-call param → Pi flag → env var →
 * config → "auto".
 */
export function resolveProviderPreference(opts: {
	paramProvider?: string;
	flagProvider?: string;
	envProvider?: string;
	configProvider?:
		| string
		| { summarize?: string; extract?: string; analyze?: string; chat?: string };
	capability: ModelCapability;
}): ResolvePreference {
	const layers = [
		opts.paramProvider,
		opts.flagProvider,
		opts.envProvider,
		// oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime values may be undefined despite TS inference
		typeof opts.configProvider === "object" && opts.configProvider !== null
			? opts.configProvider[opts.capability]
			: opts.configProvider,
	] as const;
	for (const layer of layers) {
		if (layer && typeof layer === "string") {
			const trimmed = layer.trim();
			if (trimmed) return trimmed;
		}
	}
	return "auto";
}
