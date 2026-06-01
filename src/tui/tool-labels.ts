import type { ToolContext, StructuredError } from "../types.ts";

/** Standard collapsed-result hint shown when expanded details are available. */
export const toolExpandHint = { text: "(ctrl+o to expand)", tone: "muted" as const };

/**
 * Formats a compact tool error label for result summaries.
 *
 * Example output with icons enabled:
 *
 * ```txt
 * ✕ web_batch PRIVATE_NETWORK_ADDRESS: Blocked private address
 * ```
 */
export const toolErrorLabel = (
	tool: string,
	error: StructuredError,
	options?: { allowIcons?: boolean },
): string => `${options?.allowIcons ? "✕ " : ""}${tool} ${error.code}: ${error.message}`;

/** Returns the stale freshness warning segment when cached output needs attention. */
export const toolFreshnessLabel = (envelope: Partial<ToolContext<unknown>>): string | undefined =>
	envelope.freshness?.stale ? "⚠ stale" : undefined;

/** Reads an optional session notice from tool diagnostics for display below summaries. */
export function toolSessionNotice(envelope: Partial<ToolContext<unknown>>): string | undefined {
	const notice = envelope.diagnostics?.sessionNotice;
	return typeof notice === "string" ? notice : undefined;
}

/** Extracts the stored context-package response id used by batch/crawl expanded views. */
export function toolContextPackageResponseId(
	envelope: Partial<ToolContext<unknown>>,
): string | undefined {
	const value = envelope.diagnostics?.contextPackage as { responseId?: unknown } | undefined;
	return typeof value?.responseId === "string" ? value.responseId : undefined;
}
