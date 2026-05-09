/**
 * @fileoverview Pi terminal UI progress bar primitive.
 */
export function renderProgressBar(progress: number, width = 12): string {
	const clamped = Math.max(0, Math.min(1, progress));
	const filled = Math.round(clamped * width);
	const empty = width - filled;
	return `[${"=".repeat(Math.max(0, filled - 1))}${filled > 0 ? ">" : ""}${" ".repeat(Math.max(0, empty))}]`;
}
