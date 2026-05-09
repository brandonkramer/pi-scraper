/**
 * @fileoverview Pi terminal UI progress-to-status-pill bridge helpers.
 */
import type { ProgressDetails } from "../types.js";
import type { StatusPillState } from "./status-pill.js";

export function progressStartedAtMs(
	details: ProgressDetails,
): number | undefined {
	const ms = Date.parse(details.timing?.startedAt ?? "");
	return Number.isFinite(ms) ? ms : undefined;
}

export function progressPillState(state: string): StatusPillState {
	if (state === "done" || state === "error") return state;
	return state === "queued" || state === "waiting" ? "waiting" : "loading";
}

export function progressPillLabel(state: string): string {
	if (state === "queued") return "waiting";
	return state === "processing" || state === "connecting" ? "loading" : state;
}
