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

/**
 * Minimal pi-tui-compatible component returned by custom tool renderers.
 *
 * @remarks
 * Pi's interactive renderer calls `child.render(width)` on custom render output;
 * returning plain strings crashes the TUI. Keeping this small structural type
 * avoids a runtime dependency on pi-tui while matching the component contract.
 */
export interface RenderComponent {
	render(width: number): string[];
	invalidate(): void;
}

export interface WebTool<TParameters extends TSchema = TSchema> {
	name: `web_${string}`;
	label: string;
	description: string;
	parameters: TParameters;
	execute: ToolExecute<Static<TParameters>>;
	renderCall?: (
		args: Static<TParameters>,
		theme?: RenderTheme,
	) => RenderComponent;
	renderResult?: (
		result: PiToolShell,
		options: RenderOptions,
		theme?: RenderTheme,
	) => RenderComponent;
}

export interface PiToolRegistrar {
	registerTool(tool: WebTool): void;
}

export function defineWebTool<TParameters extends TSchema>(
	tool: WebTool<TParameters>,
): WebTool<TParameters> {
	return tool;
}
