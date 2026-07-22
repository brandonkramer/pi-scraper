/** @file Index module. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerWebCommands } from "./commands/register.ts";
import { registerSessionStartHealthChecks } from "./health.ts";
import { registerWebLifecycle } from "./lifecycle.ts";
import { registerWebTools } from "./tools/infra/register.ts";

export default async function registerPiScraperExtension(pi: ExtensionAPI): Promise<void> {
	pi.registerFlag("web-model-provider", {
		description:
			"Override the model-adapter provider for web_extract action=summarize and action=adhoc (auto|off|<id>).",
		type: "string",
	});
	await registerWebTools(pi);
	registerWebCommands(pi);
	registerSessionStartHealthChecks(pi);
	registerWebLifecycle(pi);
	registerToolErrorPropagation(pi);
}

function registerToolErrorPropagation(pi: ExtensionAPI): void {
	pi.on("tool_result", (event) => {
		if (!event.toolName.startsWith("web_") || event.isError) return;
		const err = (event.details as { error?: unknown } | undefined)?.error;
		return err ? { isError: true } : undefined;
	});
}
