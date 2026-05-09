/**
 * @fileoverview Tool-specific result renderers built on shared TUI primitives.
 */
import type { PiToolShell, ResultEnvelope } from "../types.js";
import type { RenderComponent, RenderTheme } from "./define.js";
import { renderText } from "../tui/text.js";

export { renderText } from "../tui/text.js";

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
