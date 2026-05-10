/**
 * @fileoverview Pi terminal UI progress primitives — bar, status bridge, and fallback card.
 */
import type { ProgressDetails } from "../types.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";
import { renderText } from "./text.ts";
import { renderStatusGlyph, renderStatusPill } from "./pill.ts";
import {
	activityCountSegment,
	failureCountSegment,
	successCountSegment,
} from "./counts.ts";
import { formatChecklistItem, formatChecklistText } from "./checklist.ts";
import type { StatusPillState } from "./pill.ts";

export function renderProgressBar(progress: number, width = 12): string {
	const clamped = Math.max(0, Math.min(1, progress));
	const filled = Math.round(clamped * width);
	const empty = width - filled;
	return `[${"=".repeat(Math.max(0, filled - 1))}${filled > 0 ? ">" : ""}${" ".repeat(Math.max(0, empty))}]`;
}

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

export function renderProgressCard(
	toolName: `web_${string}`,
	details: ProgressDetails,
	theme?: RenderTheme,
	options?: { allowIcons?: boolean },
): RenderComponent {
	const startedAtMs = progressStartedAtMs(details) ?? Date.now();
	const icons = options?.allowIcons ?? false;
	return {
		render(width: number) {
			const statusWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
			const state = progressPillState(details.state);
			const count = details.total
				? ` ${details.current ?? 0}/${details.total}`
				: "";
			const message = details.message ? ` · ${details.message}` : "";
			const url = details.url ? ` · ${details.url}` : "";
			const glyph = renderStatusGlyph(state, theme);
			const pill = renderStatusPill({
				label: progressPillLabel(details.state),
				state,
				width: statusWidth,
				theme,
				startedAtMs,
			});
			const lines = [
				`${glyph} ${toolName} ${details.state}${count}${url}${message} ${pill}`,
			];
			if (details.checklist?.length) {
				const formatter = icons ? formatChecklistItem : formatChecklistText;
				lines.push(...details.checklist.map(formatter));
			}
			if (details.counts) {
				const counts = details.counts;
				lines.push(
					[
						counts.succeeded === undefined
							? undefined
							: icons
								? successCountSegment(counts.succeeded, "succeeded", theme)
								: `${counts.succeeded} succeeded`,
						counts.failed === undefined
							? undefined
							: icons
								? failureCountSegment(counts.failed, "failed", theme)
								: `${counts.failed} failed`,
						counts.cacheHits === undefined
							? undefined
							: icons
								? activityCountSegment(
										counts.cacheHits,
										"cache hits",
										"ⓞ",
										theme,
									)
								: `${counts.cacheHits} cache hits`,
					]
						.filter(Boolean)
						.join(" · "),
				);
			}
			return renderText(lines.filter(Boolean).join("\n"), {
				padToWidth: true,
			}).render(width);
		},
		invalidate() {},
	};
}
