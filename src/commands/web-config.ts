/**
 * @file Entry point for the /web-config slash command. Dispatches to sub-actions: status,
 *   model-provider, scrape-mode, cache, robots. No-args opens an interactive picker when
 *   ctx.ui.select is available.
 */
import { type Static, Type } from "@earendil-works/pi-ai";

import { toolResult } from "../tools/infra/result.ts";
import { defineWebCommand, type CommandContext } from "./define.ts";
import { runWebConfigCache } from "./web-config-cache.ts";
import { runWebConfigModelProvider } from "./web-config-model-provider.ts";
import { runWebConfigRobots } from "./web-config-robots.ts";
import { runWebConfigScrapeMode } from "./web-config-scrape-mode.ts";
import { runWebConfigStatus } from "./web-config-status.ts";

export const webConfigSchema = Type.Object({
	action: Type.Optional(
		Type.Union([
			Type.Literal("status"),
			Type.Literal("model-provider"),
			Type.Literal("scrape-mode"),
			Type.Literal("cache"),
			Type.Literal("robots"),
		]),
	),
	provider: Type.Optional(Type.String()),
	mode: Type.Optional(Type.String()),
	format: Type.Optional(Type.String()),
	op: Type.Optional(Type.Union([Type.Literal("stats"), Type.Literal("clear")])),
	value: Type.Optional(Type.Union([Type.Literal("on"), Type.Literal("off")])),
	force: Type.Optional(Type.Boolean()),
});

export type Params = Static<typeof webConfigSchema>;

const ACTION_LABELS = ["Status", "Model provider", "Scrape mode", "Cache", "Robots"] as const;

const LABEL_TO_ACTION: Record<string, string> = {
	Status: "status",
	"Model provider": "model-provider",
	"Scrape mode": "scrape-mode",
	Cache: "cache",
	Robots: "robots",
};

export async function runWebConfigCommand(params: Params, ctx?: CommandContext) {
	if (!params.action) {
		if (ctx?.ui?.select) {
			const picked = await ctx.ui.select("Web config", [...ACTION_LABELS], {
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
			return await runWebConfigStatus(params, ctx);
		}
	}
	const action = params.action;
	if (!action) {
		return await runWebConfigStatus(params, ctx);
	}
	switch (action) {
		case "status":
			return await runWebConfigStatus(params, ctx);
		case "model-provider":
			return await runWebConfigModelProvider(params, ctx);
		case "scrape-mode":
			return await runWebConfigScrapeMode(params, ctx);
		case "cache":
			return await runWebConfigCache(params, ctx);
		case "robots":
			return await runWebConfigRobots(params, ctx);
		default:
			return toolResult({
				text: "Unknown action. Use status, model-provider, scrape-mode, cache, or robots.",
				data: { error: "unknown_action" },
			});
	}
}

export function parseWebConfigCommandArgs(args: string): Params {
	const trimmed = args.trim();
	if (!trimmed) return {};
	if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Params;

	const [action, ...rest] = trimmed.split(/\s+/u);
	if (!isKnownAction(action)) {
		throw new Error(
			`Unknown action: ${action}. Use status, model-provider, scrape-mode, cache, or robots.`,
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
			const [mode, format] = rest;
			return { action, mode, format };
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
	}
}

function isKnownAction(value: string): value is NonNullable<Params["action"]> {
	return ["status", "model-provider", "scrape-mode", "cache", "robots"].includes(value);
}

export const webConfigCommand = defineWebCommand({
	name: "web-config",
	description:
		"Inspect effective web config (including live adapter resolution), set model-provider/scrape-mode/robots defaults, or manage the response cache.",
	parameters: webConfigSchema,
	parseArgs: parseWebConfigCommandArgs,
	execute: (params, ctx) => runWebConfigCommand(params, ctx),
});
