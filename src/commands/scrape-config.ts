/**
 * @file Entry point for the /scrape-config slash command. Dispatches to sub-actions: status,
 *   model-provider, scrape-mode, cache, robots, reload. No-args opens an interactive picker when
 *   ctx.ui.select is available.
 */
import { type Static, Type } from "typebox";

import { toolResult } from "../tools/infra/result.ts";
import { defineWebCommand, type CommandContext } from "./define.ts";
import { runScrapeConfigCache } from "./scrape-config-cache.ts";
import { runScrapeConfigModelProvider } from "./scrape-config-model-provider.ts";
import { runScrapeConfigReload } from "./scrape-config-reload.ts";
import { runScrapeConfigRobots } from "./scrape-config-robots.ts";
import { runScrapeConfigScrapeMode } from "./scrape-config-scrape-mode.ts";
import { runScrapeConfigStatus } from "./scrape-config-status.ts";

export const scrapeConfigSchema = Type.Object({
	action: Type.Optional(
		Type.Union([
			Type.Literal("status"),
			Type.Literal("model-provider"),
			Type.Literal("scrape-mode"),
			Type.Literal("cache"),
			Type.Literal("robots"),
			Type.Literal("reload"),
		]),
	),
	provider: Type.Optional(Type.String()),
	mode: Type.Optional(Type.String()),
	format: Type.Optional(Type.String()),
	maxBytes: Type.Optional(
		Type.Integer({ description: "Max bytes to fetch (e.g. 31457280 for 30 MB)." }),
	),
	op: Type.Optional(Type.Union([Type.Literal("stats"), Type.Literal("clear")])),
	value: Type.Optional(Type.Union([Type.Literal("on"), Type.Literal("off")])),
	force: Type.Optional(Type.Boolean()),
});

export type Params = Static<typeof scrapeConfigSchema>;

const ACTION_LABELS = [
	"Status",
	"Model provider",
	"Scrape mode",
	"Cache",
	"Robots",
	"Reload",
] as const;

const LABEL_TO_ACTION: Record<string, string> = {
	Status: "status",
	"Model provider": "model-provider",
	"Scrape mode": "scrape-mode",
	Cache: "cache",
	Robots: "robots",
	Reload: "reload",
};

export async function runScrapeConfigCommand(params: Params, ctx?: CommandContext) {
	if (!params.action) {
		if (ctx?.ui?.select) {
			const picked = await ctx.ui.select("Scrape config", [...ACTION_LABELS], {
				signal: ctx.signal,
			});
			if (!picked) {
				return toolResult({
					text: "Cancelled.",
					data: { cancelled: true },
				});
			}
			params = {
				...params,
				action: LABEL_TO_ACTION[picked] as Params["action"],
			};
		} else {
			return await runScrapeConfigStatus(params, ctx);
		}
	}
	const action = params.action;
	if (!action) {
		return await runScrapeConfigStatus(params, ctx);
	}
	switch (action) {
		case "status":
			return await runScrapeConfigStatus(params, ctx);
		case "model-provider":
			return await runScrapeConfigModelProvider(params, ctx);
		case "scrape-mode":
			return await runScrapeConfigScrapeMode(params, ctx);
		case "cache":
			return await runScrapeConfigCache(params, ctx);
		case "robots":
			return await runScrapeConfigRobots(params, ctx);
		case "reload":
			return await runScrapeConfigReload();
		default:
			return toolResult({
				text: "Unknown action. Use status, model-provider, scrape-mode, cache, robots, or reload.",
				data: { error: "unknown_action" },
			});
	}
}

export function parseScrapeConfigCommandArgs(args: string): Params {
	const trimmed = args.trim();
	if (!trimmed) return {};
	if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Params;

	const [action, ...rest] = trimmed.split(/\s+/u);
	if (!isKnownAction(action)) {
		throw new Error(
			`Unknown action: ${action}. Use status, model-provider, scrape-mode, cache, robots, or reload.`,
		);
	}

	switch (action) {
		case "status":
			return { action };
		case "model-provider": {
			const [provider] = rest;
			return { action, provider };
		}
		case "scrape-mode": {
			const [mode, format, maxBytesStr] = rest;
			const maxBytes = maxBytesStr ? Number.parseInt(maxBytesStr, 10) : undefined;
			return {
				action,
				mode,
				format,
				maxBytes: maxBytes && Number.isFinite(maxBytes) ? maxBytes : undefined,
			};
		}
		case "cache": {
			const force = rest.includes("--force");
			const op = rest.find((t) => t !== "--force");
			if (op && op !== "stats" && op !== "clear") {
				throw new Error("Expected cache op 'stats' or 'clear'.");
			}
			return { action, op: op as Params["op"], force };
		}
		case "robots": {
			const [value] = rest;
			if (value && value !== "on" && value !== "off") {
				throw new Error("Expected robots value 'on' or 'off'.");
			}
			return { action, value: value as Params["value"] };
		}
		case "reload":
			return { action };
	}
}

function isKnownAction(value: string): value is NonNullable<Params["action"]> {
	return ["status", "model-provider", "scrape-mode", "cache", "robots", "reload"].includes(value);
}

export const scrapeConfigCommand = defineWebCommand({
	name: "scrape-config",
	description:
		"Inspect effective scrape config (including live adapter resolution), set model-provider/scrape-mode/robots defaults, manage the response cache, or reload config from disk.",
	parameters: scrapeConfigSchema,
	parseArgs: parseScrapeConfigCommandArgs,
	execute: (params, ctx) => runScrapeConfigCommand(params, ctx),
});
