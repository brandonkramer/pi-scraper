import type { ToolContext, StructuredError } from "../types.ts";

export const toolExpandHint = { text: "(ctrl+o to expand)", tone: "muted" as const };

export const formatChecklistText = (item: { label: string; detail?: string }): string =>
	`${item.label}${item.detail ? ` — ${item.detail}` : ""}`;

export const toolErrorLabel = (
	tool: string,
	error: StructuredError,
	options?: { allowIcons?: boolean },
): string => `${options?.allowIcons ? "✕ " : ""}${tool} ${error.code}: ${error.message}`;

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
