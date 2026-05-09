/**
 * @fileoverview Pi terminal UI spinner and spinner-footer primitives.
 */
export const SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

export function renderSpinner(tick: number, message = "Working..."): string {
	const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
	return `${frame} ${message}`;
}

export function currentSpinnerFrame(): string {
	const tick = Math.floor(Date.now() / 80);
	return SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
}

export function withSpinnerFooter(lines: string[], tick?: number): string {
	if (typeof tick !== "number") return lines.join("\n");
	return [...lines, "", renderSpinner(tick)].join("\n");
}
