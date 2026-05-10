/**
 * @fileoverview Shared Pi tool adapter contracts for web tools.
 */
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { PiToolShell } from "../../types.ts";
import type { RenderComponent, RenderTheme } from "../../tui/types.ts";

export type ToolUpdate = (result: PiToolShell) => void | Promise<void>;

export interface ToolExecutionContext {
	hasUI?: boolean;
	model?: unknown;
	/** Reserved for future Pi host injection of a model-adapter registry. Currently unused; pi-scraper consumes its own singleton. */
	modelRegistry?: unknown;
	ui?: unknown;
	getFlag?: (name: string) => string | undefined;
}

export type ToolExecute<TParams> = (
	toolCallId: string,
	params: TParams,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
	context?: ToolExecutionContext,
) => Promise<PiToolShell>;

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

export interface PiToolEvents {
	on(event: string, handler: (payload: unknown) => void): void;
	emit(event: string, payload: unknown): void;
}

export interface PiToolRegistrar {
	registerTool(tool: WebTool): void;
	events?: PiToolEvents;
}

export function defineWebTool<TParameters extends TSchema>(
	tool: WebTool<TParameters>,
): WebTool<TParameters> {
	return tool;
}
