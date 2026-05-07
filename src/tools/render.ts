import type { PiToolShell, ResultEnvelope } from "../types.js";
import type { RenderComponent, RenderTheme } from "./define.js";

class TextRenderComponent implements RenderComponent {
	constructor(
		private readonly text: string,
		private readonly options: { padToWidth?: boolean } = {},
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width || 80));
		const lines = this.text
			.split("\n")
			.flatMap((line) => wrapAnsiAwareLine(line, safeWidth));
		return this.options.padToWidth
			? lines.map((line) => padAnsiAwareLine(line, safeWidth))
			: lines;
	}

	invalidate(): void {
		// Static text renderers have no cached state to clear.
	}
}

const ansiPattern = /\u001B\[[0-?]*[ -/]*[@-~]/g;

function wrapAnsiAwareLine(line: string, width: number): string[] {
	if (visibleWidth(line) <= width) return [line];
	const chunks: string[] = [];
	let remaining = line;
	while (visibleWidth(remaining) > width) {
		const chunk = truncateToWidth(remaining, Math.max(1, width - 1));
		chunks.push(`${chunk}…`);
		remaining = remaining.slice(chunk.length);
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}

function padAnsiAwareLine(line: string, width: number): string {
	const padding = Math.max(0, width - visibleWidth(line));
	return padding ? `${line}${" ".repeat(padding)}` : line;
}

function visibleWidth(text: string): number {
	return text.replace(ansiPattern, "").length;
}

function truncateToWidth(text: string, width: number): string {
	let output = "";
	let used = 0;
	let index = 0;
	while (index < text.length && used < width) {
		const ansi = text.slice(index).match(/^\u001B\[[0-?]*[ -/]*[@-~]/);
		if (ansi) {
			output += ansi[0];
			index += ansi[0].length;
			continue;
		}
		const char = text[index] ?? "";
		output += char;
		used += 1;
		index += char.length;
	}
	return output;
}

export function renderText(
	text: string,
	options: { padToWidth?: boolean } = {},
): RenderComponent {
	return new TextRenderComponent(text, options);
}

export function renderSimpleCall(
	name: string,
	parts: Array<string | undefined>,
	theme?: RenderTheme,
): RenderComponent {
	const text = `${name} ${parts.filter(Boolean).join(" ")}`.trim();
	return renderText(theme?.fg?.("accent", text) ?? text);
}

export function renderEnvelopeResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| undefined;
	const status = details?.status ? `${details.status}` : "done";
	const id = details?.responseId ? ` · responseId: ${details.responseId}` : "";
	const url = details?.finalUrl ?? details?.url;
	const preview = result.content[0]?.text ?? "";
	const summary = details?.summary ?? `${status}${url ? ` · ${url}` : ""}${id}`;
	return renderText(
		expanded
			? expandedEnvelopeText(summary, preview, details)
			: summary.slice(0, 220),
		{ padToWidth: true },
	);
}

function expandedEnvelopeText(
	summary: string,
	preview: string,
	details: Partial<ResultEnvelope<unknown>> | undefined,
): string {
	const lines = [summary];
	if (details?.answerContext) {
		lines.push("", details.answerContext.slice(0, 500));
	} else if (preview) {
		lines.push("", preview.slice(0, 500));
	}
	if (details?.nextActions?.length) {
		lines.push(
			"",
			"Next actions:",
			...details.nextActions
				.slice(0, 3)
				.map(
					(action) =>
						`- ${action.action}${action.tool ? ` via ${action.tool}` : ""}: ${action.description}`,
				),
		);
	}
	return lines.join("\n");
}

export function summarizeData(value: unknown): string {
	if (Array.isArray(value))
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (value && typeof value === "object")
		return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
	return String(value ?? "done");
}
