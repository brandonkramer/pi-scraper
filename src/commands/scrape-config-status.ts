import { loadEffectiveConfig, type EffectiveWebConfig } from "../config.ts";
/**
 * @file Status sub-action for /scrape-config. Shows effective config, live adapter-resolution
 *   chain, and cache stats.
 */
import { DEFAULT_MAX_BYTES } from "../defaults.ts";
import { resolveModelAdapterFromContext } from "../tools/infra/model-adapter.ts";
import { modelRegistry } from "../tools/infra/model-registry.ts";
import { toolResult } from "../tools/infra/result.ts";
import type { CommandContext } from "./define.ts";
import type { Params } from "./scrape-config.ts";

export interface WebConfigStatusReport {
	effectiveConfig: EffectiveWebConfig;
	piHostModel: { detected: boolean; label: string };
	registeredAdapters: Array<{
		id: string;
		label: string;
		priority: number;
		capabilities: readonly string[];
	}>;
	resolutionPrecedence: Array<{ layer: string; value: string }>;
	activeResolution: string;
}

export async function runScrapeConfigStatus(_params: Params, ctx?: CommandContext) {
	const config = await loadEffectiveConfig();
	const report = await assembleStatusReport(config, ctx);
	return toolResult({
		text: formatStatusText(report),
		data: report,
	});
}

async function assembleStatusReport(
	config: EffectiveWebConfig,
	ctx?: CommandContext,
): Promise<WebConfigStatusReport> {
	const piHost = detectPiHostModel(ctx);
	const adapters = modelRegistry.list().map((e) => ({
		id: e.id,
		label: e.label,
		priority: e.priority,
		capabilities: e.capabilities,
	}));

	const precedence: Array<{ layer: string; value: string }> = [
		{
			layer: "per-call provider param",
			value: "(unobservable from /scrape-config)",
		},
		{
			layer: "Pi flag --web-model-provider",
			value: "(unobservable from /scrape-config)",
		},
		{
			layer: "env PI_WEB_MODEL_PROVIDER",
			value: process.env.PI_WEB_MODEL_PROVIDER ?? "(unset)",
		},
		{
			layer: "config modelProvider",
			value: formatModelProvider(config.modelProvider),
		},
	];

	const auto = modelRegistry.resolve("auto", "summarize");
	const activeResolution = auto
		? `would route through "${modelRegistry.list().find((e) => e.adapter === auto)?.id ?? "unknown"}"`
		: "no matching adapter registered";

	return {
		effectiveConfig: config,
		piHostModel: piHost,
		registeredAdapters: adapters,
		resolutionPrecedence: precedence,
		activeResolution: piHost.detected
			? "Pi-host model preempts registered adapters"
			: activeResolution,
	};
}

function detectPiHostModel(ctx?: CommandContext): { detected: boolean; label: string } {
	const adapter = ctx ? resolveModelAdapterFromContext(ctx) : undefined;
	return adapter
		? { detected: true, label: "detected via Pi host context" }
		: { detected: false, label: "not detected" };
}

function formatModelProvider(value: unknown): string {
	if (value === null || value === undefined) return "auto";
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

function formatStatusText(report: WebConfigStatusReport): string {
	const cfg = report.effectiveConfig;
	const lines = [
		"Scrape config status",
		"",
		"Effective config:",
		`- scrapeMode: ${cfg.scrapeMode}`,
		`- outputFormat: ${cfg.outputFormat}`,
		`- respectRobots: ${cfg.scrapeDefaults.respectRobots ?? true}`,
		`- maxBytes: ${cfg.scrapeDefaults.maxBytes ?? DEFAULT_MAX_BYTES}`,
		`- modelProvider: ${formatModelProvider(cfg.modelProvider)}`,
		"",
		"Model adapter resolution (summarize capability):",
		`- Pi-host model: ${report.piHostModel.label}`,
		`- Registered adapters: ${report.registeredAdapters.length}`,
		...report.registeredAdapters.map(
			(a) => `  - ${a.id} (priority ${a.priority}, capabilities: ${a.capabilities.join(", ")})`,
		),
		"",
		"Preference precedence (highest wins):",
		...report.resolutionPrecedence.map((p) => `- ${p.layer}: ${p.value}`),
		"",
		`- Active resolution: ${report.activeResolution}`,
	];
	return lines.join("\n");
}
