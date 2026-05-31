/** @file Pi terminal UI spinner and spinner-footer primitives. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function renderSpinner(tick: number, message = "Working..."): string {
	const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
	return `${frame} ${message}`;
}

export function currentSpinnerFrame(): string {
	const tick = Math.floor(Date.now() / 80);
	return SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
}

export function withSpinnerFooter(lines: string[], tick?: number): string {
	if (typeof tick !== "number") return lines.join("\n");
	return [...lines, "", renderSpinner(tick)].join("\n");
}

/**
 * @file ToolProcess — batch/crawl process line with progress stats. Example: `└─ web_batch · 3/3
 *   done · ok 3 · err 0 · concurrency 3`
 */
import { muted, separator } from "./theme.ts";
import { toolStatus, type ToolStatusPart } from "./tool-status.ts";
import type { RenderTheme } from "./types.ts";

export function toolProcess(
	prefix: string,
	parts: Array<string | ToolStatusPart | undefined | false>,
	theme?: RenderTheme,
): string {
	const body = toolStatus(parts, theme);
	const head = muted("└─ ", theme);
	return body ? `${head}${prefix}${separator(theme)}${body}` : `${head}${prefix}`;
}
