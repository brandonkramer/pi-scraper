/** @file Index module. */
import { closeAllBrowserSessions } from "./browser/session-pool.ts";
import type { PiCommandRegistrar } from "./commands/define.ts";
import { registerWebCommands } from "./commands/register.ts";
import {
	registerSessionStartHealthChecks,
	type PiHealthRegistrar,
} from "./health/session-start.ts";
import { closeStorageDbs } from "./storage/db/open.ts";
import type { PiToolRegistrar } from "./tools/infra/define.ts";
import { registerWebTools } from "./tools/infra/register.ts";

type PiScraperRegistrar = PiToolRegistrar & PiCommandRegistrar & PiHealthRegistrar;

export default async function registerPiScraperExtension(pi: PiScraperRegistrar): Promise<void> {
	pi.registerFlag?.("web-model-provider", {
		description:
			"Override the model-adapter provider for web_summarize and web_extract action=adhoc (auto|off|<id>).",
		type: "string",
	});
	await registerWebTools(pi);
	registerWebCommands(pi);
	registerSessionStartHealthChecks(pi);
	wireCleanupHooks();
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
	const runCleanupAndExit = (code: number) => {
		void cleanup().finally(() => process.exit(code));
	};
	// SIGTERM / SIGINT: clean up then explicitly exit so Node doesn't hang
	process.once("SIGTERM", () => runCleanupAndExit(143));
	process.once("SIGINT", () => runCleanupAndExit(130));
	// beforeExit: process is already draining; fire-and-forget cleanup
	process.once("beforeExit", () => {
		void cleanup();
	});
}
