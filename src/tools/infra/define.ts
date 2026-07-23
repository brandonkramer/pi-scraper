/** @file Web-tool authoring types and a checked adapter to Pi's native ToolDefinition. */
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";

import type { RenderComponent, RenderTheme } from "../../tui/index.ts";
import type { PiToolShell } from "../../types.ts";

export type ToolUpdate = (result: PiToolShell) => void | Promise<void>;

/** Context fields consumed by web tools, plus the extension-level flag reader. */
export interface ToolExecutionContext {
	hasUI?: ExtensionContext["hasUI"];
	model?: ExtensionContext["model"];
	modelRegistry?: ExtensionContext["modelRegistry"];
	ui?: ExtensionContext["ui"];
	signal?: ExtensionContext["signal"];
	cwd?: ExtensionContext["cwd"];
	isProjectTrusted?: ExtensionContext["isProjectTrusted"];
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
	promptSnippet?: string;
	promptGuidelines?: string[];
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

let readFlag: ((name: string) => string | undefined) | undefined;

export function configureToolFlagReader(
	reader: ((name: string) => string | undefined) | undefined,
): void {
	readFlag = reader;
}

export function defineWebTool<TParameters extends TSchema>(
	tool: WebTool<TParameters>,
): WebTool<TParameters> {
	return tool;
}

/**
 * Adapt the scraper's text-only result/rendering boundary to Pi's full tool contract. This keeps
 * every production registration checked without erasing types through `unknown`.
 */
export function toPiToolDefinition<TParameters extends TSchema>(
	tool: WebTool<TParameters>,
): ToolDefinition<TParameters, unknown, Record<string, unknown>> {
	const renderCall = tool.renderCall;
	const renderResult = tool.renderResult;
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		promptSnippet: tool.promptSnippet,
		promptGuidelines: tool.promptGuidelines,
		parameters: tool.parameters,
		async execute(toolCallId, params, signal, onUpdate, context) {
			const update: ToolUpdate | undefined = onUpdate ? (result) => onUpdate(result) : undefined;
			return await tool.execute(
				toolCallId,
				params,
				signal ?? new AbortController().signal,
				update,
				adaptExecutionContext(context),
			);
		},
		renderCall: renderCall ? (args, theme, context) => renderCall(args, theme, context) : undefined,
		renderResult: renderResult
			? (result, options, theme, context) =>
					renderResult(
						{
							content: result.content.flatMap((item) =>
								item.type === "text" ? [{ type: "text" as const, text: item.text }] : [],
							),
							details: result.details,
						},
						options,
						theme,
						context,
					)
			: undefined,
	};
}

function adaptExecutionContext(context: ExtensionContext): ToolExecutionContext {
	return {
		hasUI: context.hasUI,
		model: context.model,
		modelRegistry: context.modelRegistry,
		ui: context.ui,
		signal: context.signal,
		cwd: context.cwd,
		isProjectTrusted: () => context.isProjectTrusted(),
		getFlag: readFlag,
	};
}

/** Lightweight registrar interface for tests and internal use. */
export interface PiToolRegistrar {
	registerTool(tool: WebTool): void;
	events?: {
		on(event: string, handler: (payload: unknown) => void): void;
		emit(event: string, payload: unknown): void;
	};
	getFlag?: (name: string) => boolean | string | undefined;
}
