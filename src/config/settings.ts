import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_SCRAPE_MODE } from "../defaults.js";
import {
	ensureDir,
	type ResolveStorageOptions,
	resolvePiStoragePaths,
} from "../storage/paths.js";
import type { OutputFormat, ScrapeMode } from "../types.js";

export interface WebConfig {
	scrapeMode?: ScrapeMode;
	outputFormat?: OutputFormat;
}

export interface EffectiveWebConfig
	extends Required<Pick<WebConfig, "scrapeMode" | "outputFormat">> {}

export interface ConfigOptions extends ResolveStorageOptions {}

export const DEFAULT_WEB_CONFIG: EffectiveWebConfig = {
	scrapeMode: DEFAULT_SCRAPE_MODE,
	outputFormat: DEFAULT_OUTPUT_FORMAT,
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
	return saveConfig({ ...current, ...stripUndefined(patch) }, options);
}

export function mergeConfig(config: WebConfig): EffectiveWebConfig {
	return { ...DEFAULT_WEB_CONFIG, ...config };
}

function normalizeConfig(input: unknown): WebConfig {
	if (typeof input !== "object" || input === null) return {};
	const raw = input as WebConfig;
	return {
		scrapeMode: raw.scrapeMode,
		outputFormat: raw.outputFormat,
	};
}

function stripUndefined(config: WebConfig): WebConfig {
	return Object.fromEntries(
		Object.entries(config).filter(([, value]) => value !== undefined),
	) as WebConfig;
}
