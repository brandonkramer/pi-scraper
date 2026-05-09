/**
 * @fileoverview Shared Pi tool adapter contracts for web tools.
 */
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { PiToolShell } from "../types.js";

export type ToolUpdate = (result: PiToolShell) => void | Promise<void>;

export interface ToolExecutionContext {
	hasUI?: boolean;
	model?: unknown;
	modelRegistry?: unknown;
	ui?: unknown;
}

export type ToolExecute<TParams> = (
	toolCallId: string,
	params: TParams,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
	context?: ToolExecutionContext,
) => Promise<PiToolShell>;

export interface RenderTheme {
	fg?: (name: string, text: string) => string;
	bg?: (name: string, text: string) => string;
	bold?: (text: string) => string;
}

export interface RenderOptions {
	expanded?: boolean;
	isPartial?: boolean;
}

/** Pi renderer lifecycle context passed to custom tool renderers when available. */
export interface ToolRenderContext<TParams = unknown> {
	args?: TParams;
	expanded?: boolean;
	isPartial?: boolean;
	executionStarted?: boolean;
	invalidate?: () => void;
	lastComponent?: RenderComponent;
	state?: Record<string, unknown>;
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
		context?: ToolRenderContext<Static<TParameters>>,
	) => RenderComponent;
	renderResult?: (
		result: PiToolShell,
		options: RenderOptions,
		theme?: RenderTheme,
		context?: ToolRenderContext,
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
