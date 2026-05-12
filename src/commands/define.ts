import type { Static, TSchema } from "@earendil-works/pi-ai";
/** @file Shared Pi command adapter contracts for web commands. */
import type { ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";

import type { PiToolShell } from "../types.ts";

export type CommandExecute<TParams> = (
	params: TParams,
	ctx?: CommandContext,
) => Promise<PiToolShell> | PiToolShell;

/** Subset of ExtensionCommandContext used by web commands. */
export interface CommandContext {
	signal?: AbortSignal;
	hasUI?: boolean;
	ui?: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		select?(
			title: string,
			choices: readonly string[],
			options?: ExtensionUIDialogOptions,
		): Promise<string | undefined>;
		confirm?(title: string, message: string, options?: ExtensionUIDialogOptions): Promise<boolean>;
		input?(
			title: string,
			placeholder?: string,
			options?: ExtensionUIDialogOptions,
		): Promise<string | undefined>;
	};
}

export interface RegisteredCommandOptions {
	description?: string;
	handler(args: string, ctx: CommandContext): Promise<void>;
}

export interface WebCommand<TParameters extends TSchema = TSchema> {
	name: `web-${string}` | `scrape-${string}`;
	description: string;
	parameters: TParameters;
	parseArgs?: (args: string) => Static<TParameters>;
	execute: CommandExecute<Static<TParameters>>;
}

export interface PiCommandRegistrar {
	registerCommand(name: string, options: RegisteredCommandOptions): void;
	registerFlag?(name: string, options: { description: string; type: string }): void;
}

export function defineWebCommand<TParameters extends TSchema>(
	command: WebCommand<TParameters>,
): WebCommand<TParameters> {
	return command;
}
