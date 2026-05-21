/** @file ResultEnvelope helpers — label formatters and generic summary card. */
import { Markdown } from "@earendil-works/pi-tui";

import type { ModelUsage } from "../extract/adhoc/model.ts";
import type { PiToolShell, ResultEnvelope, StructuredError } from "../types.ts";
import { defineResultRenderer } from "./result-renderer.ts";
import { getMarkdownTheme } from "./theme.ts";
import { createTreeBuilder, type TreeSection } from "./tree.ts";
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
	const preview = result.content[0]?.text ?? "";
	const summary =
		details?.summary ??
		[
			details?.status ?? "done",
			details?.finalUrl ?? details?.url,
			details?.responseId ? `responseId: ${details.responseId}` : undefined,
			details?.freshness?.stale ? "stale" : undefined,
		]
			.filter(Boolean)
			.join(" · ");
	const body = expanded ? expandedEnvelopeText(summary, preview, details) : summary;
	const hasLongMarkdown = expanded && details?.format === "markdown" && preview.length > 100;
	return defineResultRenderer({
		renderContent: () => body,
		padToWidth: true,
		markdownPreview: hasLongMarkdown
			? () => new Markdown(preview.slice(0, 800), 0, 0, getMarkdownTheme(theme))
			: undefined,
	});
}

function expandedEnvelopeText(
	summary: string,
	preview: string,
	details: Partial<ResultEnvelope<unknown>> | undefined,
): string {
	const b = createTreeBuilder();
	if (details?.freshness?.stale) b.add("info", "freshness", "stale; refresh if time-sensitive");
	const usageLine = details?.modelUsage ? formatModelUsage(details.modelUsage) : undefined;
	if (usageLine) b.add("info", "model usage", usageLine);
	const extra =
		b.sections.length > 0
			? b.sections.map((s) => s.rows.map((r) => `${r.key}: ${r.value}`).join("\n")).join("\n") +
				"\n"
			: "";
	const previewBlock = (details?.answerContext ?? preview).slice(0, 500);
	const next = details?.nextActions
		?.slice(0, 3)
		.map((a) => `- ${a.action}${a.tool ? ` via ${a.tool}` : ""}: ${a.description}`)
		.join("\n");
	return [summary, extra, previewBlock, next ? `\nNext actions:\n${next}` : ""]
		.filter(Boolean)
		.join("\n");
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

export const DEFAULT_HIDDEN_ENVELOPE_KEYS = new Set(
	"_stored __id format contentType fullOutputPath text sources citations sourceNotes modelUsage nextActions assistantGuidance kind snapshotSaved diagnostics cache freshness qualitySignals headers downloadedBytes timing summary answerContext finalUrl error".split(
		" ",
	),
);

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
	const sectionName = options.sectionName ?? "result";

	const fieldMap = new Map<string, string>();
	for (const [key, value] of Object.entries(envelope ?? {})) {
		if (hide.has(key) || value === null || value === undefined) continue;
		if (typeof value === "string" && !value) continue;
		const val = stringifyEnvelopeValue(value);
		fieldMap.set(key, describe[key] ? `${val} (${describe[key]})` : val);
	}

	const b = createTreeBuilder();
	for (const key of order)
		if (fieldMap.has(key)) {
			b.add(sectionName, key, fieldMap.get(key));
			fieldMap.delete(key);
		}
	for (const [key, value] of fieldMap) b.add(sectionName, key, value);
	return b.sections;
}
