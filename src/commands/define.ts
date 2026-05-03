import type { Static, TSchema } from "@mariozechner/pi-ai";
import type { PiToolShell } from "../types.js";

export type CommandExecute<TParams> = (params: TParams, signal?: AbortSignal) => Promise<PiToolShell> | PiToolShell;

export interface WebCommand<TParameters extends TSchema = TSchema> {
  name: `web-${string}`;
  description: string;
  parameters: TParameters;
  execute: CommandExecute<Static<TParameters>>;
}

export interface PiCommandRegistrar {
  registerCommand(command: WebCommand): void;
}

export function defineWebCommand<TParameters extends TSchema>(command: WebCommand<TParameters>): WebCommand<TParameters> {
  return command;
}
