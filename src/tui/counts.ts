/**
 * @fileoverview Pi terminal UI count segment primitives for success/failure/activity.
 */
import type { RenderTheme } from "./types.ts";
import {
	activityText,
	failureText,
	neutralText,
	successText,
} from "./theme.ts";

export function successCountSegment(
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	const text = `${count} ${label}`;
	if (count <= 0) return neutralText(text, theme);
	return successText(`✓ ${text}`, theme);
}

export function failureCountSegment(
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	return failureText(`✖ ${count} ${label}`, theme);
}

export function activityCountSegment(
	count: number,
	label: string,
	icon: string,
	theme?: RenderTheme,
): string {
	return activityText(`${icon}  ${count} ${label}`, theme);
}
