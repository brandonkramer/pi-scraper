import type { Static, TSchema } from "@mariozechner/pi-ai";
import type { PiToolShell } from "../types.js";

export type CommandExecute<TParams> = (
	params: TParams,
	signal?: AbortSignal,
) => Promise<PiToolShell> | PiToolShell;

export interface CommandContext {
	signal?: AbortSignal;
	ui?: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

export interface RegisteredCommandOptions {
	description?: string;
	handler(args: string, ctx: CommandContext): Promise<void>;
}

export interface WebCommand<TParameters extends TSchema = TSchema> {
	name: `web-${string}`;
	description: string;
	parameters: TParameters;
	parseArgs?: (args: string) => Static<TParameters>;
	execute: CommandExecute<Static<TParameters>>;
}

export interface PiCommandRegistrar {
	registerCommand(name: string, options: RegisteredCommandOptions): void;
}

export function defineWebCommand<TParameters extends TSchema>(
	command: WebCommand<TParameters>,
): WebCommand<TParameters> {
	return command;
}
