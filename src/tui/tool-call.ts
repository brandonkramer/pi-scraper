import { toolStatus, type ToolStatusPart } from "./tool-status.ts";
import { muted, paintFg, renderDynamicText, separator } from "./tui.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

/**
 * Renders the compact call header for a tool invocation.
 *
 * Example output:
 *
 * ```txt
 * web_scrape (auto → markdown)
 * ```
 */
export function toolCall(
	name: string,
	parts: (string | undefined)[],
	theme?: RenderTheme,
): RenderComponent {
	const label = [name, ...(parts.filter(Boolean) as string[])].join(" ");
	return renderDynamicText(() => paintFg(theme, "accent", label));
}

/**
 * Renders a prefixed process/status line for grouped tool work.
 *
 * Example output:
 *
 * ```txt
 * └─ web_batch · 1/3 done · ok 1 · err 0
 * ```
 */
export function toolCallStatus(
	prefix: string,
	parts: Array<string | ToolStatusPart | undefined | false>,
	theme?: RenderTheme,
): string {
	const body = toolStatus(parts, theme);
	return `${muted("└─ ", theme)}${prefix}${body ? `${separator(theme)}${body}` : ""}`;
}
