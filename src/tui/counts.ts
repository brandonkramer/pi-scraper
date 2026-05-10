/**
 * @fileoverview Pi terminal UI count segment primitives for success/failure/activity.
 */
import type { RenderTheme } from "./types.ts";
import {
	activity,
	failure,
	neutral,
	success,
} from "./theme.ts";

export function successCountSegment(
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	const text = `${count} ${label}`;
	if (count <= 0) return neutral(text, theme);
	return success(`✓ ${text}`, theme);
}

export function failureCountSegment(
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	return failure(`✖ ${count} ${label}`, theme);
}

export function activityCountSegment(
	count: number,
	label: string,
	icon: string,
	theme?: RenderTheme,
): string {
	return activity(`${icon}  ${count} ${label}`, theme);
}
