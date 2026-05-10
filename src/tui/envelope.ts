/**
 * @fileoverview ResultEnvelope helpers — label formatters and generic summary card.
 */
import type { PiToolShell, ResultEnvelope, StructuredError } from "../types.ts";
import type { RenderComponent } from "./types.ts";
import { renderText } from "./text.ts";

export function errorLabel(
	tool: string,
	error: StructuredError,
	options?: { allowIcons?: boolean },
): string {
	const prefix = options?.allowIcons ? "✕ " : "";
	return `${prefix}${tool} ${error.code}: ${error.message}`;
}

export function cacheLabel(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	if (!envelope.cache?.cached) return undefined;
	return `↻ cache hit${envelope.cache.staleness ? ` ${envelope.cache.staleness}` : ""}`;
}

export function freshnessLabel(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	return envelope.freshness?.stale ? "⚠ stale" : undefined;
}

export function sessionNotice(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	const notice = envelope.diagnostics?.sessionNotice;
	return typeof notice === "string" ? notice : undefined;
}

export function contextPackageResponseId(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	const value = envelope.diagnostics?.contextPackage;
	if (typeof value !== "object" || value === null) return undefined;
	const responseId = (value as { responseId?: unknown }).responseId;
	return typeof responseId === "string" ? responseId : undefined;
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
