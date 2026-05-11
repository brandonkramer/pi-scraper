/**
 * @file Status sub-action for /web-config. Shows effective config, live adapter-resolution chain,
 *   and cache stats.
 */
import { loadEffectiveConfig, type EffectiveWebConfig } from "../config/settings.ts";
import { modelRegistry } from "../tools/infra/model-registry.ts";
import { piHostAdapterAvailable } from "../tools/infra/register.ts";
import { toolResult } from "../tools/infra/result.ts";
import type { CommandContext } from "./define.ts";
import type { Params } from "./web-config.ts";

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

export async function runWebConfigStatus(_params: Params, ctx?: CommandContext) {
	const config = await loadEffectiveConfig();
	const report = await assembleStatusReport(config, ctx);
	return toolResult({
		text: formatStatusText(report),
		data: report,
	});
}

async function assembleStatusReport(
	config: EffectiveWebConfig,
	_ctx?: CommandContext,
): Promise<WebConfigStatusReport> {
	const piHost = detectPiHostModel();
	const adapters = modelRegistry.list().map((e) => ({
		id: e.id,
		label: e.label,
		priority: e.priority,
		capabilities: e.capabilities,
	}));

	const precedence: Array<{ layer: string; value: string }> = [
		{
			layer: "per-call provider param",
			value: "(unobservable from /web-config)",
		},
		{
			layer: "Pi flag --web-model-provider",
			value: "(unobservable from /web-config)",
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

function detectPiHostModel(): { detected: boolean; label: string } {
	return piHostAdapterAvailable()
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
		"Web config status",
		"",
		"Effective config:",
		`- scrapeMode: ${cfg.scrapeMode}`,
		`- outputFormat: ${cfg.outputFormat}`,
		`- respectRobots: ${cfg.scrapeDefaults.respectRobots ?? true}`,
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
