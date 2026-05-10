/**
 * @fileoverview Pick a human-readable preview string from a Pi tool result + envelope. Generic; does not branch on tool name.
 */
import type { PiToolShell, ResultEnvelope } from "../types.ts";

export function previewText(
	result: PiToolShell,
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
): string {
	const data = envelope.data;
	return String(
		envelope.answerContext ??
			data?.markdown ??
			data?.text ??
			data?.title ??
			result.content[0]?.text ??
			"",
	);
}
