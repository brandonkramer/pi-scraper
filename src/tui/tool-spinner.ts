/** Braille spinner frames used by live progress rows and footers. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Returns the current time-based spinner frame. */
export function currentSpinnerFrame(): string {
	return SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
}

/**
 * Appends a transient spinner footer to multi-line batch progress text.
 *
 * Example output when `tick` is provided:
 *
 * ```txt
 * row one
 *
 * ⠋ Working...
 * ```
 */
export function withSpinnerFooter(lines: string[], tick?: number): string {
	if (typeof tick !== "number") return lines.join("\n");
	return [...lines, "", `${SPINNER_FRAMES[tick % SPINNER_FRAMES.length]} Working...`].join("\n");
}
