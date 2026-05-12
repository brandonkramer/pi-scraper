/** @file Commands register module. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { WebCommand } from "./define.ts";
import { scrapeConfigCommand } from "./scrape-config.ts";

export const webCommands: readonly WebCommand[] = [scrapeConfigCommand];

export function registerWebCommands(pi: ExtensionAPI): void {
	for (const command of webCommands) {
		pi.registerCommand(command.name, {
			description: command.description,
			async handler(args, ctx) {
				const params = command.parseArgs ? command.parseArgs(args) : parseJsonObjectArgs(args);
				const result = await command.execute(params as never, ctx);
				const message = result.content[0]?.text;
				if (message) ctx.ui.notify(message, "info");
			},
		});
	}
}

function parseJsonObjectArgs(args: string): Record<string, unknown> {
	const trimmed = args.trim();
	if (!trimmed) return {};
	const parsed: unknown = JSON.parse(trimmed);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Command arguments must be a JSON object.");
	}
	return parsed as Record<string, unknown>;
}
