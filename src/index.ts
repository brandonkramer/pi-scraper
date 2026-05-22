/** @file Index module. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { closeAllBrowserSessions } from "./browser/session-pool.ts";
import { registerWebCommands } from "./commands/register.ts";
import { registerSessionStartHealthChecks, type PiHealthRegistrar } from "./health.ts";
import { closeStorageDbs } from "./storage/db/open.ts";
import { registerWebTools } from "./tools/infra/register.ts";

export default async function registerPiScraperExtension(pi: ExtensionAPI): Promise<void> {
	pi.registerFlag("web-model-provider", {
		description:
			"Override the model-adapter provider for web_extract action=summarize and action=adhoc (auto|off|<id>).",
		type: "string",
	});
	await registerWebTools(pi);
	registerWebCommands(pi);
	registerSessionStartHealthChecks(pi as PiHealthRegistrar);
	registerToolErrorPropagation(pi);
	wireCleanupHooks();
}

function registerToolErrorPropagation(pi: ExtensionAPI): void {
	pi.on("tool_result", (event) => {
		if (!event.toolName.startsWith("web_") || event.isError) return;
		const err = (event.details as { error?: unknown } | undefined)?.error;
		return err ? { isError: true } : undefined;
	});
}

function wireCleanupHooks(): void {
	let cleanedUp = false;
	const cleanup = async (): Promise<void> => {
		if (cleanedUp) return;
		cleanedUp = true;
		await closeStorageDbs();
		await closeAllBrowserSessions().catch(() => {
			/* ignore */
		});
	};
	const exitAfter = (code: number) => void cleanup().finally(() => process.exit(code));
	process.once("SIGTERM", () => exitAfter(143));
	process.once("SIGINT", () => exitAfter(130));
	process.once("beforeExit", () => void cleanup());
}
