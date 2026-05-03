import type { Static, TSchema } from "@mariozechner/pi-ai";
import type { PiToolShell } from "../types.js";

export type ToolUpdate = (result: PiToolShell) => void | Promise<void>;

export type ToolExecute<TParams> = (
  toolCallId: string,
  params: TParams,
  signal: AbortSignal,
  onUpdate?: ToolUpdate,
) => Promise<PiToolShell>;

export interface RenderTheme {
  fg?: (name: string, text: string) => string;
  bold?: (text: string) => string;
}

export interface RenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

export interface WebTool<TParameters extends TSchema = TSchema> {
  name: `web_${string}`;
  label: string;
  description: string;
  parameters: TParameters;
  execute: ToolExecute<Static<TParameters>>;
  renderCall?: (args: Static<TParameters>, theme?: RenderTheme) => string;
  renderResult?: (result: PiToolShell, options: RenderOptions, theme?: RenderTheme) => string;
}

export interface PiToolRegistrar {
  registerTool(tool: WebTool): void;
}

export function defineWebTool<TParameters extends TSchema>(tool: WebTool<TParameters>): WebTool<TParameters> {
  return tool;
}
