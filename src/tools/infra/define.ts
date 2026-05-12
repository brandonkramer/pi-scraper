/** @file Shared Pi tool adapter contracts for web tools. */
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { RenderComponent, RenderTheme } from "../../tui/types.ts";
import type { PiToolShell } from "../../types.ts";

export type ToolUpdate = (result: PiToolShell) => void | Promise<void>;

/** Subset of ExtensionContext used by web tools, plus getFlag for CLI flag access. */
export interface ToolExecutionContext {
	hasUI?: ExtensionContext["hasUI"];
	model?: ExtensionContext["model"];
	modelRegistry?: ExtensionContext["modelRegistry"];
	ui?: ExtensionContext["ui"];
	signal?: ExtensionContext["signal"];
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

/**
 * Lightweight registrar interface for tests and internal use.
 *
 * @remarks
 *   The production entrypoint (`registerPiScraperExtension`) receives the full {@link ExtensionAPI}
 *   and passes it through to the functions below without cast.
 */
export interface PiToolRegistrar {
	registerTool(tool: WebTool): void;
	events?: {
		on(event: string, handler: (payload: unknown) => void): void;
		emit(event: string, payload: unknown): void;
	};
}

export function defineWebTool<TParameters extends TSchema>(
	tool: WebTool<TParameters>,
): WebTool<TParameters> {
	return tool;
}
