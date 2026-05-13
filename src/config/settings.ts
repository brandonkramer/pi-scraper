/** @file Config settings module. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_OUTPUT_FORMAT, DEFAULT_SCRAPE_MODE } from "../defaults.ts";
import { ensureDir, type ResolveStorageOptions, resolvePiStoragePaths } from "../storage/paths.ts";
import type { CommonScrapeOptions, OutputFormat, ScrapeMode } from "../types.ts";

type PersistedScrapeDefaults = Partial<Omit<CommonScrapeOptions, "mode" | "format">>;

export type ModelProviderConfig = string | { summarize?: string; extract?: string };

export interface WebConfig {
	scrapeMode?: ScrapeMode;
	outputFormat?: OutputFormat;
	scrapeDefaults?: PersistedScrapeDefaults;
	modelProvider?: ModelProviderConfig;
}

export interface EffectiveWebConfig extends Required<
	Pick<WebConfig, "scrapeMode" | "outputFormat">
> {
	scrapeDefaults: PersistedScrapeDefaults;
	modelProvider?: ModelProviderConfig;
}

export type ConfigOptions = ResolveStorageOptions;

export const DEFAULT_WEB_CONFIG: EffectiveWebConfig = {
	scrapeMode: DEFAULT_SCRAPE_MODE,
	outputFormat: DEFAULT_OUTPUT_FORMAT,
	scrapeDefaults: {},
	modelProvider: undefined,
};

export function configFilePath(options: ConfigOptions = {}): string {
	return path.join(resolvePiStoragePaths(options).config, "web.json");
}

export async function loadStoredConfig(options: ConfigOptions = {}): Promise<WebConfig> {
	try {
		return normalizeConfig(JSON.parse(await readFile(configFilePath(options), "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

const configCache = new Map<string, Promise<EffectiveWebConfig>>();

export async function loadEffectiveConfig(
	options: ConfigOptions = {},
): Promise<EffectiveWebConfig> {
	const filePath = configFilePath(options);
	let entry = configCache.get(filePath);
	if (!entry) {
		entry = (async () => mergeConfig(await loadStoredConfig(options)))();
		configCache.set(filePath, entry);
		entry.catch(() => configCache.delete(filePath));
	}
	return await entry;
}

/** Clear the effective-config cache for all paths. */
export function clearEffectiveConfigCache(): void {
	configCache.clear();
}

/** Re-read and cache the effective config for a given path. */
export async function reloadEffectiveConfig(
	options: ConfigOptions = {},
): Promise<EffectiveWebConfig> {
	configCache.delete(configFilePath(options));
	return await loadEffectiveConfig(options);
}

export async function saveConfig(
	config: WebConfig,
	options: ConfigOptions = {},
): Promise<EffectiveWebConfig> {
	const normalized = normalizeConfig(config);
	const filePath = configFilePath(options);
	await ensureDir(path.dirname(filePath));
	await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, {
		mode: 0o600,
	});
	configCache.delete(filePath);
	return mergeConfig(normalized);
}

export async function updateConfig(
	patch: WebConfig,
	options: ConfigOptions = {},
): Promise<EffectiveWebConfig> {
	const current = await loadStoredConfig(options);
	const cleaned = Object.fromEntries(
		Object.entries(patch).filter(([, v]) => v !== undefined && v !== ""),
	) as WebConfig;
	return await saveConfig(
		{
			...current,
			...cleaned,
			scrapeDefaults: {
				...current.scrapeDefaults,
				...cleaned.scrapeDefaults,
			},
		},
		options,
	);
}

export function mergeConfig(config: WebConfig): EffectiveWebConfig {
	return {
		...DEFAULT_WEB_CONFIG,
		...config,
		scrapeDefaults: {
			...DEFAULT_WEB_CONFIG.scrapeDefaults,
			...config.scrapeDefaults,
		},
		modelProvider: config.modelProvider ?? DEFAULT_WEB_CONFIG.modelProvider,
	};
}

function normalizeConfig(input: unknown): WebConfig {
	if (typeof input !== "object" || input === null) return {};
	const raw = input as WebConfig;
	return {
		scrapeMode: raw.scrapeMode,
		outputFormat: raw.outputFormat,
		scrapeDefaults: normalizeScrapeDefaults(raw.scrapeDefaults),
		modelProvider: normalizeModelProvider(raw.modelProvider),
	};
}

function normalizeModelProvider(input: unknown): ModelProviderConfig | undefined {
	if (typeof input === "string") return input;
	if (typeof input === "object" && input !== null) {
		const raw = input as Record<string, unknown>;
		const entries = Object.entries(raw).filter(([, v]) => typeof v === "string");
		if (entries.length > 0) return Object.fromEntries(entries) as ModelProviderConfig;
	}
}

function normalizeScrapeDefaults(input: unknown): PersistedScrapeDefaults | undefined {
	if (typeof input !== "object" || input === null) return;
	const raw = input as PersistedScrapeDefaults;
	return Object.fromEntries(
		Object.entries({
			timeoutSeconds: raw.timeoutSeconds,
			maxBytes: raw.maxBytes,
			maxChars: raw.maxChars,
			headers:
				raw.headers && typeof raw.headers === "object"
					? Object.fromEntries(
							Object.entries(raw.headers).filter(
								(entry): entry is [string, string] => typeof entry[1] === "string",
							),
						)
					: undefined,
			proxy: raw.proxy,
			respectRobots: raw.respectRobots,
			cacheTtlSeconds: raw.cacheTtlSeconds,
			maxAgeSeconds: raw.maxAgeSeconds,
			refresh: raw.refresh,
			retryAttempts: boundedNumber(raw.retryAttempts, 0, 10),
			retryBaseDelayMs: boundedNumber(raw.retryBaseDelayMs, 0, 60_000),
			retryMaxDelayMs: boundedNumber(raw.retryMaxDelayMs, 0, 300_000),
			retryJitterMs: boundedNumber(raw.retryJitterMs, 0, 60_000),
			include: raw.include,
			exclude: raw.exclude,
			onlyMainContent: raw.onlyMainContent,
			removeImages: raw.removeImages,
			cookies: raw.cookies,
			browserProfile: raw.browserProfile,
			osProfile: raw.osProfile,
		}).filter(([, v]) => v !== undefined && v !== ""),
	) as PersistedScrapeDefaults;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return;
	return Math.max(minimum, Math.min(maximum, value));
}
