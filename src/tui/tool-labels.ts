/** @file Pi terminal UI checklist formatting primitives. */
import type { ToolContext, StructuredError } from "../types.ts";

const CHECKLIST_ICONS: Record<string, string> = {
	done: "✓",
	failed: "✕",
	warning: "⚠",
	pending: "☐",
};

export function formatChecklistItem(item: {
	label: string;
	state: string;
	detail?: string;
}): string {
	return `${CHECKLIST_ICONS[item.state] ?? "•"} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}

export function formatChecklistText(item: { label: string; detail?: string }): string {
	return `${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}

/** @file Tool label builders. */

// ── Label functions ───────────────────────────────────────────────

export function errorLabel(
	tool: string,
	error: StructuredError,
	options?: { allowIcons?: boolean },
): string {
	const prefix = options?.allowIcons ? "✕ " : "";
	return `${prefix}${tool} ${error.code}: ${error.message}`;
}

export function cacheLabel(envelope: Partial<ToolContext<unknown>>): string | undefined {
	if (!envelope.cache?.cached) return;
	return `↻ cache hit${envelope.cache.staleness ? ` ${envelope.cache.staleness}` : ""}`;
}

export function freshnessLabel(envelope: Partial<ToolContext<unknown>>): string | undefined {
	return envelope.freshness?.stale ? "⚠ stale" : undefined;
}

export function sessionNotice(envelope: Partial<ToolContext<unknown>>): string | undefined {
	const notice = envelope.diagnostics?.sessionNotice;
	return typeof notice === "string" ? notice : undefined;
}

export function contextPackageResponseId(
	envelope: Partial<ToolContext<unknown>>,
): string | undefined {
	const value = envelope.diagnostics?.contextPackage as { responseId?: unknown } | undefined;
	return typeof value?.responseId === "string" ? value.responseId : undefined;
}

// ── Tool-prefixed aliases ──────────────────────────────────────────

export const toolErrorLabel = errorLabel;
export const toolCacheLabel = cacheLabel;
export const toolFreshnessLabel = freshnessLabel;
export const toolSessionNotice = sessionNotice;
export const toolContextPackageResponseId = contextPackageResponseId;
