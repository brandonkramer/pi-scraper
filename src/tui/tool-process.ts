import { muted, separator } from "./theme.ts";
import { SPINNER_FRAMES, toolStatus, type ToolStatusPart } from "./tool-status.ts";
import type { RenderTheme } from "./types.ts";

export function withSpinnerFooter(lines: string[], tick?: number): string {
	if (typeof tick !== "number") return lines.join("\n");
	return [...lines, "", `${SPINNER_FRAMES[tick % SPINNER_FRAMES.length]} Working...`].join("\n");
}

export function toolProcess(
	prefix: string,
	parts: Array<string | ToolStatusPart | undefined | false>,
	theme?: RenderTheme,
): string {
	const body = toolStatus(parts, theme);
	return `${muted("└─ ", theme)}${prefix}${body ? `${separator(theme)}${body}` : ""}`;
}
