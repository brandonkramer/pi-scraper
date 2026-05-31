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

export function toolErrorLabel(
	tool: string,
	error: StructuredError,
	options?: { allowIcons?: boolean },
): string {
	const prefix = options?.allowIcons ? "✕ " : "";
	return `${prefix}${tool} ${error.code}: ${error.message}`;
}

export function toolFreshnessLabel(envelope: Partial<ToolContext<unknown>>): string | undefined {
	return envelope.freshness?.stale ? "⚠ stale" : undefined;
}

export function toolSessionNotice(envelope: Partial<ToolContext<unknown>>): string | undefined {
	const notice = envelope.diagnostics?.sessionNotice;
	return typeof notice === "string" ? notice : undefined;
}

export function toolContextPackageResponseId(
	envelope: Partial<ToolContext<unknown>>,
): string | undefined {
	const value = envelope.diagnostics?.contextPackage as { responseId?: unknown } | undefined;
	return typeof value?.responseId === "string" ? value.responseId : undefined;
}

// ── Tool-prefixed aliases ──────────────────────────────────────────
