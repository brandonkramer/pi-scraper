/**
 * @fileoverview Width-safe text render components for Pi tool cards.
 */
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { PiToolShell, ResultEnvelope } from "../types.js";
import type { RenderComponent, RenderTheme } from "./define.js";

class TextRenderComponent implements RenderComponent {
	constructor(
		private readonly text: string,
		private readonly options: { padToWidth?: boolean; truncate?: boolean } = {},
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width || 80));
		const lines = this.text
			.split("\n")
			.flatMap((line) =>
				this.options.truncate
					? [truncateAnsiAwareLine(line, safeWidth)]
					: wrapAnsiAwareLine(line, safeWidth),
			);
		return this.options.padToWidth
			? lines.map((line) => padAnsiAwareLine(line, safeWidth))
			: lines;
	}

	invalidate(): void {
		// Static text renderers have no cached state to clear.
	}
}

function wrapAnsiAwareLine(line: string, width: number): string[] {
	return wrapTextWithAnsi(line.replaceAll("\t", "   "), width);
}

function truncateAnsiAwareLine(line: string, width: number): string {
	return truncateToWidth(line.replaceAll("\t", "   "), width, "…");
}

function padAnsiAwareLine(line: string, width: number): string {
	return truncateToWidth(line, width, "", true);
}

export function renderText(
	text: string,
	options: { padToWidth?: boolean; truncate?: boolean } = {},
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
	const freshness = details?.freshness?.stale ? " · stale" : "";
	const summary =
		details?.summary ?? `${status}${url ? ` · ${url}` : ""}${id}${freshness}`;
	return renderText(
		expanded ? expandedEnvelopeText(summary, preview, details) : summary,
		{ padToWidth: true, truncate: !expanded },
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
	if (details?.freshness?.stale) {
		lines.push("", "Freshness: stale; refresh source if time-sensitive.");
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
