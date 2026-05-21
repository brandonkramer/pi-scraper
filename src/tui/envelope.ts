/** @file ResultEnvelope helpers — label formatters and generic summary card. */
import { Markdown } from "@earendil-works/pi-tui";

import type { ModelUsage } from "../extract/adhoc/model.ts";
import type { PiToolShell, ResultEnvelope, StructuredError } from "../types.ts";
import { defineResultRenderer } from "./result-renderer.ts";
import { renderText } from "./text.ts";
import { getMarkdownTheme } from "./theme.ts";
import type { TreeSection } from "./tree.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

export function errorLabel(
	tool: string,
	error: StructuredError,
	options?: { allowIcons?: boolean },
): string {
	const prefix = options?.allowIcons ? "✕ " : "";
	return `${prefix}${tool} ${error.code}: ${error.message}`;
}

export function cacheLabel(envelope: Partial<ResultEnvelope<unknown>>): string | undefined {
	if (!envelope.cache?.cached) return;
	return `↻ cache hit${envelope.cache.staleness ? ` ${envelope.cache.staleness}` : ""}`;
}

export function freshnessLabel(envelope: Partial<ResultEnvelope<unknown>>): string | undefined {
	return envelope.freshness?.stale ? "⚠ stale" : undefined;
}

export function sessionNotice(envelope: Partial<ResultEnvelope<unknown>>): string | undefined {
	const notice = envelope.diagnostics?.sessionNotice;
	return typeof notice === "string" ? notice : undefined;
}

export function contextPackageResponseId(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	const value = envelope.diagnostics?.contextPackage;
	if (typeof value !== "object" || value === null) return;
	const responseId = (value as { responseId?: unknown }).responseId;
	return typeof responseId === "string" ? responseId : undefined;
}

export function renderEnvelopeResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ResultEnvelope<unknown>> | undefined;
	const status = details?.status ? `${details.status}` : "done";
	const id = details?.responseId ? ` · responseId: ${details.responseId}` : "";
	const url = details?.finalUrl ?? details?.url;
	const preview = result.content[0]?.text ?? "";
	const freshness = details?.freshness?.stale ? " · stale" : "";
	const summary = details?.summary ?? `${status}${url ? ` · ${url}` : ""}${id}${freshness}`;
	const body = expanded ? expandedEnvelopeText(summary, preview, details) : summary;
	if (!expanded || details?.format !== "markdown" || preview.length <= 100) {
		return renderText(body, { padToWidth: true });
	}
	return defineResultRenderer({
		renderContent: () => body,
		padToWidth: true,
		markdownPreview: () => new Markdown(preview.slice(0, 800), 0, 0, getMarkdownTheme(theme)),
	});
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
	const usageLine = details?.modelUsage ? formatModelUsage(details.modelUsage) : undefined;
	if (usageLine) {
		lines.push("", usageLine);
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

/** Build a compact one-line usage footer. Returns undefined when no fields are presentable. */
function formatModelUsage(u: ModelUsage): string | undefined {
	const parts: string[] = [];
	if (u.provider) parts.push(u.provider);
	if (u.model) parts.push(u.model);
	if (typeof u.inputTokens === "number") parts.push(`${u.inputTokens} in`);
	if (typeof u.outputTokens === "number") parts.push(`${u.outputTokens} out`);
	if (typeof u.totalTokens === "number") parts.push(`${u.totalTokens} total`);
	if (typeof u.costUSD === "number") parts.push(formatCostUSD(u.costUSD));
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatCostUSD(cost: number): string {
	if (cost === 0) return "$0";
	if (cost < 0.0001) return `~$${cost.toExponential(1)}`;
	if (cost < 1) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

export const DEFAULT_HIDDEN_ENVELOPE_KEYS = new Set([
	"_stored",
	"__id",
	"format",
	"contentType",
	"fullOutputPath",
	"text",
	"sources",
	"citations",
	"sourceNotes",
	"modelUsage",
	"nextActions",
	"assistantGuidance",
	"kind",
	"snapshotSaved",
	"diagnostics",
	"cache",
	"freshness",
	"qualitySignals",
	"headers",
	"downloadedBytes",
	"timing",
	"summary",
	"answerContext",
	"finalUrl",
	"error",
]);

export const DEFAULT_ENVELOPE_KEY_DESCRIPTIONS: Record<string, string> = {
	text: "summary",
	data: "response payload",
	url: "source URL",
	responseId: "stored response ID",
	jobId: "job identifier",
	summary: "overview",
	answerContext: "agent context",
	source: "source label",
};

export const DEFAULT_ENVELOPE_DISPLAY_ORDER = ["truncated", "responseId", "data", "url"] as const;

export interface BuildEnvelopeRowsOptions {
	hide?: ReadonlySet<string>;
	describe?: Record<string, string>;
	order?: readonly string[];
	sectionName?: string;
}

export function stringifyEnvelopeValue(value: unknown): string {
	if (typeof value === "string") return value.slice(0, 80);
	if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (value && typeof value === "object") {
		const keys = Object.keys(value);
		return `${keys.length} field${keys.length === 1 ? "" : "s"}`;
	}
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	return "[unknown]";
}

export function buildEnvelopeRows(
	envelope: Record<string, unknown> | undefined,
	options: BuildEnvelopeRowsOptions = {},
): TreeSection[] {
	const hide = options.hide ?? DEFAULT_HIDDEN_ENVELOPE_KEYS;
	const describe = options.describe ?? DEFAULT_ENVELOPE_KEY_DESCRIPTIONS;
	const order = options.order ?? DEFAULT_ENVELOPE_DISPLAY_ORDER;
	const section: TreeSection = { name: options.sectionName ?? "result", rows: [] };

	const fieldMap = new Map<string, string>();
	for (const [key, value] of Object.entries(envelope ?? {})) {
		if (hide.has(key)) continue;
		if (value === null || value === undefined) continue;
		if (typeof value === "string" && !value) continue;
		const desc = describe[key];
		const val = stringifyEnvelopeValue(value);
		fieldMap.set(key, desc ? `${val} (${desc})` : val);
	}

	for (const key of order) {
		if (fieldMap.has(key)) {
			section.rows.push({ key, value: fieldMap.get(key)! });
			fieldMap.delete(key);
		}
	}
	for (const [key, value] of fieldMap) {
		section.rows.push({ key, value });
	}

	return section.rows.length > 0 ? [section] : [];
}
