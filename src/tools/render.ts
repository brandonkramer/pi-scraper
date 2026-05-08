/**
 * @fileoverview Width-safe text render components for Pi tool cards.
 */
import type { PiToolShell, ResultEnvelope } from "../types.js";
import type { RenderComponent, RenderTheme } from "./define.js";

class TextRenderComponent implements RenderComponent {
	constructor(
		private readonly text: string,
		private readonly options: { padToWidth?: boolean; truncate?: boolean } = {},
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width || 80));
		const lines = this.text
			.split("\n")
			.flatMap((line) =>
				this.options.truncate
					? [truncateAnsiAwareLine(line, safeWidth)]
					: wrapAnsiAwareLine(line, safeWidth),
			);
		return this.options.padToWidth
			? lines.map((line) => padAnsiAwareLine(line, safeWidth))
			: lines;
	}

	invalidate(): void {
		// Static text renderers have no cached state to clear.
	}
}

type GraphemeSegment = { segment: string };
type GraphemeSegmenter = {
	segment(input: string): Iterable<GraphemeSegment>;
};

const fallbackSegmenter = ((): GraphemeSegmenter | undefined => {
	const intlWithSegmenter = Intl as typeof Intl & {
		Segmenter?: new (
			locale?: string,
			options?: { granularity: "grapheme" },
		) => GraphemeSegmenter;
	};
	const Segmenter = intlWithSegmenter.Segmenter;
	return Segmenter
		? new Segmenter(undefined, { granularity: "grapheme" })
		: undefined;
})();

function wrapAnsiAwareLine(line: string, width: number): string[] {
	const normalizedLine = line.replaceAll("\t", "   ");
	if (visibleWidth(normalizedLine) <= width) return [normalizedLine];
	const chunks: string[] = [];
	let remaining = normalizedLine;
	while (visibleWidth(remaining) > width) {
		const chunk = truncateToWidth(remaining, Math.max(1, width - 1));
		if (!chunk) {
			chunks.push("…");
			remaining = dropFirstVisibleGrapheme(remaining);
			continue;
		}
		chunks.push(`${chunk}…`);
		remaining = remaining.slice(chunk.length);
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}

function truncateAnsiAwareLine(line: string, width: number): string {
	const normalizedLine = line.replaceAll("\t", "   ");
	if (visibleWidth(normalizedLine) <= width) return normalizedLine;
	if (width <= 1) return "…";
	return `${truncateToWidth(normalizedLine, width - 1)}\u001B[39m…`;
}

function padAnsiAwareLine(line: string, width: number): string {
	const padding = Math.max(0, width - visibleWidth(line));
	return padding ? `${line}${" ".repeat(padding)}` : line;
}

function visibleWidth(text: string): number {
	let width = 0;
	let index = 0;
	while (index < text.length) {
		const ansi = extractAnsiSequence(text, index);
		if (ansi) {
			index += ansi.length;
			continue;
		}
		const grapheme = nextGrapheme(text, index);
		width += graphemeWidth(grapheme);
		index += grapheme.length || 1;
	}
	return width;
}

function truncateToWidth(text: string, width: number): string {
	let output = "";
	let used = 0;
	let index = 0;
	while (index < text.length && used < width) {
		const ansi = extractAnsiSequence(text, index);
		if (ansi) {
			output += ansi.code;
			index += ansi.length;
			continue;
		}
		const grapheme = nextGrapheme(text, index);
		const nextWidth = graphemeWidth(grapheme);
		if (used + nextWidth > width) break;
		output += grapheme;
		used += nextWidth;
		index += grapheme.length || 1;
	}
	return output;
}

function extractAnsiSequence(
	text: string,
	index: number,
): { code: string; length: number } | undefined {
	if (text.charCodeAt(index) !== 0x1b) return undefined;
	const next = text[index + 1];
	if (next === "[") {
		const match = text.slice(index).match(/^\u001B\[[0-?]*[ -/]*[@-~]/);
		return match ? { code: match[0], length: match[0].length } : undefined;
	}
	if (next === "]") {
		const bel = text.indexOf("\u0007", index + 2);
		const st = text.indexOf("\u001B\\", index + 2);
		const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);
		if (end === -1) return undefined;
		const length = end - index + (end === st ? 2 : 1);
		return { code: text.slice(index, index + length), length };
	}
	return undefined;
}

function nextGrapheme(text: string, index: number): string {
	const rest = text.slice(index);
	const segmented = fallbackSegmenter
		?.segment(rest)
		[Symbol.iterator]()
		.next().value;
	if (segmented?.segment) return segmented.segment;
	const codePoint = text.codePointAt(index);
	return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function graphemeWidth(grapheme: string): number {
	if (!grapheme || isZeroWidthGrapheme(grapheme)) return 0;
	if (grapheme === "\t") return 3;
	if (isEmojiGrapheme(grapheme)) return 2;
	const codePoint = visibleCodePoint(grapheme);
	if (codePoint === undefined) return 0;
	return isWideCodePoint(codePoint) ? 2 : 1;
}

function isZeroWidthGrapheme(grapheme: string): boolean {
	for (const char of grapheme) {
		const codePoint = char.codePointAt(0);
		if (codePoint === undefined) continue;
		if (isControlOrZeroWidth(codePoint)) continue;
		return false;
	}
	return true;
}

function visibleCodePoint(grapheme: string): number | undefined {
	for (const char of grapheme) {
		const codePoint = char.codePointAt(0);
		if (codePoint === undefined || isControlOrZeroWidth(codePoint)) continue;
		return codePoint;
	}
	return undefined;
}

function isControlOrZeroWidth(codePoint: number): boolean {
	return (
		codePoint <= 0x1f ||
		(codePoint >= 0x7f && codePoint <= 0x9f) ||
		(codePoint >= 0x300 && codePoint <= 0x36f) ||
		(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
		(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
		(codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
		(codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
		codePoint === 0x200b ||
		codePoint === 0x200c ||
		codePoint === 0x200d
	);
}

function isEmojiGrapheme(grapheme: string): boolean {
	if (grapheme.includes("\uFE0F") || grapheme.includes("\u200D")) return true;
	const codePoint = visibleCodePoint(grapheme);
	return (
		codePoint !== undefined &&
		((codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
			(codePoint >= 0x2300 && codePoint <= 0x23ff) ||
			(codePoint >= 0x2600 && codePoint <= 0x27bf) ||
			(codePoint >= 0x2b50 && codePoint <= 0x2b55))
	);
}

function isWideCodePoint(codePoint: number): boolean {
	return (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		codePoint === 0x2329 ||
		codePoint === 0x232a ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6)
	);
}

function dropFirstVisibleGrapheme(text: string): string {
	let index = 0;
	while (index < text.length) {
		const ansi = extractAnsiSequence(text, index);
		if (ansi) {
			index += ansi.length;
			continue;
		}
		const grapheme = nextGrapheme(text, index);
		return text.slice(index + (grapheme.length || 1));
	}
	return "";
}

export function renderText(
	text: string,
	options: { padToWidth?: boolean; truncate?: boolean } = {},
): RenderComponent {
	return new TextRenderComponent(text, options);
}

export function renderSimpleCall(
	name: string,
	parts: Array<string | undefined>,
	theme?: RenderTheme,
): RenderComponent {
	const text = `${name} ${parts.filter(Boolean).join(" ")}`.trim();
	return renderText(theme?.fg?.("accent", text) ?? text);
}

export function renderEnvelopeResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| undefined;
	const status = details?.status ? `${details.status}` : "done";
	const id = details?.responseId ? ` · responseId: ${details.responseId}` : "";
	const url = details?.finalUrl ?? details?.url;
	const preview = result.content[0]?.text ?? "";
	const freshness = details?.freshness?.stale ? " · stale" : "";
	const summary =
		details?.summary ?? `${status}${url ? ` · ${url}` : ""}${id}${freshness}`;
	return renderText(
		expanded ? expandedEnvelopeText(summary, preview, details) : summary,
		{ padToWidth: true, truncate: !expanded },
	);
}

function expandedEnvelopeText(
	summary: string,
	preview: string,
	details: Partial<ResultEnvelope<unknown>> | undefined,
): string {
	const lines = [summary];
	if (details?.answerContext) {
		lines.push("", details.answerContext.slice(0, 500));
	} else if (preview) {
		lines.push("", preview.slice(0, 500));
	}
	if (details?.freshness?.stale) {
		lines.push("", "Freshness: stale; refresh source if time-sensitive.");
	}
	if (details?.nextActions?.length) {
		lines.push(
			"",
			"Next actions:",
			...details.nextActions
				.slice(0, 3)
				.map(
					(action) =>
						`- ${action.action}${action.tool ? ` via ${action.tool}` : ""}: ${action.description}`,
				),
		);
	}
	return lines.join("\n");
}

export function summarizeData(value: unknown): string {
	if (Array.isArray(value))
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (value && typeof value === "object")
		return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
	return String(value ?? "done");
}
