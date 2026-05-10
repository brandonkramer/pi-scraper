/**
 * @fileoverview Generic progress fallback card used by every Pi web tool when no tool-specific progress card applies.
 */
import type { ProgressDetails } from "../types.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";
import { renderText } from "./text.ts";
import { renderStatusGlyph, renderStatusPill } from "./status-pill.ts";
import {
	progressPillLabel,
	progressPillState,
	progressStartedAtMs,
} from "./progress-status.ts";
import {
	activityCountSegment,
	failureCountSegment,
	successCountSegment,
} from "./counts.ts";
import { formatChecklistItem, formatChecklistText } from "./checklist.ts";

export function renderProgress(
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
