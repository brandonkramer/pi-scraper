/**
 * @fileoverview config settings module.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_SCRAPE_MODE } from "../defaults.js";
import {
	ensureDir,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "../storage/paths.js";
import type {
	CommonScrapeOptions,
	OutputFormat,
	ScrapeMode,
} from "../types.js";

type PersistedScrapeDefaults = Partial<
	Omit<CommonScrapeOptions, "mode" | "format">
>;

export interface WebConfig {
	scrapeMode?: ScrapeMode;
	outputFormat?: OutputFormat;
	scrapeDefaults?: PersistedScrapeDefaults;
}

export interface EffectiveWebConfig
	extends Required<Pick<WebConfig, "scrapeMode" | "outputFormat">> {
	scrapeDefaults: PersistedScrapeDefaults;
}

export interface ConfigOptions extends ResolveStorageOptions {}

export const DEFAULT_WEB_CONFIG: EffectiveWebConfig = {
	scrapeMode: DEFAULT_SCRAPE_MODE,
	outputFormat: DEFAULT_OUTPUT_FORMAT,
	scrapeDefaults: {},
};

export function configFilePath(options: ConfigOptions = {}): string {
	return path.join(resolvePiStoragePaths(options).config, "web.json");
}

export async function loadStoredConfig(
	options: ConfigOptions = {},
): Promise<WebConfig> {
	try {
		return normalizeConfig(
			JSON.parse(await readFile(configFilePath(options), "utf8")),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

export async function loadEffectiveConfig(
	options: ConfigOptions = {},
): Promise<EffectiveWebConfig> {
	return mergeConfig(await loadStoredConfig(options));
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
	return mergeConfig(normalized);
}

export async function updateConfig(
	patch: WebConfig,
	options: ConfigOptions = {},
): Promise<EffectiveWebConfig> {
	const current = await loadStoredConfig(options);
	const cleaned = stripUndefined(patch);
	return saveConfig(
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
	};
}

function normalizeConfig(input: unknown): WebConfig {
	if (typeof input !== "object" || input === null) return {};
	const raw = input as WebConfig;
	return {
		scrapeMode: raw.scrapeMode,
		outputFormat: raw.outputFormat,
		scrapeDefaults: normalizeScrapeDefaults(raw.scrapeDefaults),
	};
}

function normalizeScrapeDefaults(
	input: unknown,
): PersistedScrapeDefaults | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const raw = input as PersistedScrapeDefaults;
	return stripUndefined({
		timeoutSeconds: raw.timeoutSeconds,
		maxBytes: raw.maxBytes,
		maxChars: raw.maxChars,
		headers: normalizeHeaders(raw.headers),
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
	}) as PersistedScrapeDefaults;
}

function boundedNumber(
	value: unknown,
	minimum: number,
	maximum: number,
): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.max(minimum, Math.min(maximum, value));
}

function normalizeHeaders(
	headers: unknown,
): Record<string, string> | undefined {
	if (typeof headers !== "object" || headers === null) return undefined;
	return Object.fromEntries(
		Object.entries(headers).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function stripUndefined<T extends object>(config: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(config).filter(([, value]) => value !== undefined),
	) as Partial<T>;
}
