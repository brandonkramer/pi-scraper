/** @file Agent-facing preview formatting for deterministic line-filter matches. */
import type { LineMatch, LineMatchContext } from "./line-filter.ts";

const DEFAULT_MAX_MATCHES = 8;
const DEFAULT_MAX_CHARS = 3_200;
const MAX_LINE_CHARS = 240;

export interface LineMatchPreviewOptions {
	header?: string;
	maxMatches?: number;
	maxChars?: number;
	includeOmittedHint?: boolean;
}

export interface LabeledLineMatches {
	label: string;
	matches?: readonly LineMatch[];
}

/**
 * Format line-filter matches with line numbers and captured context.
 *
 * @remarks
 *   Keeps inline result text bounded while prioritizing actual matching snippets over the start of
 *   the fetched raw file. Callers still expose responseId retrieval for the complete payload.
 */
export function formatLineMatchPreview(
	matches: readonly LineMatch[] | undefined,
	options: LineMatchPreviewOptions = {},
): string | undefined {
	if (!matches?.length) return;
	const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const header = options.header ?? "Matching line snippets";
	const lines = [`${header} (${matches.length} match${matches.length === 1 ? "" : "es"}):`];
	let emitted = 0;
	for (const match of matches) {
		if (emitted >= maxMatches) break;
		const block = formatMatchBlock(match);
		if (!appendBounded(lines, block, maxChars)) break;
		emitted += 1;
	}
	appendOmittedHint(lines, matches.length - emitted, maxChars, options.includeOmittedHint ?? true);
	return lines.join("\n");
}

/** Format per-item line matches for batch/labeled raw-inspection results. */
export function formatLabeledLineMatchPreview(
	items: readonly LabeledLineMatches[],
	options: LineMatchPreviewOptions = {},
): string | undefined {
	const matchingItems = items.filter((item) => item.matches?.length);
	if (matchingItems.length === 0) return;
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
	const lines = [options.header ?? "Matching line snippets by item:"];
	let omitted = 0;
	for (const item of matchingItems) {
		const remaining = maxChars - lines.join("\n").length;
		if (remaining <= 0) {
			omitted += item.matches?.length ?? 0;
			continue;
		}
		const rendered = formatLineMatchPreview(item.matches, {
			header: item.label,
			maxChars: remaining,
			maxMatches,
			includeOmittedHint: false,
		});
		if (!rendered || !appendBounded(lines, [rendered], maxChars)) {
			omitted += item.matches?.length ?? 0;
			continue;
		}
		omitted += Math.max(0, (item.matches?.length ?? 0) - maxMatches);
	}
	const totalMatches = matchingItems.reduce((sum, item) => sum + (item.matches?.length ?? 0), 0);
	appendOmittedHint(lines, omitted, maxChars, options.includeOmittedHint ?? true);
	if (lines.length === 1) return `Matching line snippets: ${totalMatches} match(es).`;
	return lines.join("\n");
}

function formatMatchBlock(match: LineMatch): string[] {
	return [
		`- needle "${clipLine(match.needle)}" at line ${match.line}`,
		...match.contextBefore.map((context) => formatContextLine(" ", context)),
		formatContextLine(">", match),
		...match.contextAfter.map((context) => formatContextLine(" ", context)),
	];
}

function formatContextLine(prefix: " " | ">", context: LineMatchContext): string {
	return `${prefix} ${context.line}: ${clipLine(context.text)}`;
}

function appendBounded(lines: string[], block: readonly string[], maxChars: number): boolean {
	const nextLength = lines.join("\n").length + 1 + block.join("\n").length;
	if (nextLength > maxChars) return false;
	lines.push(...block);
	return true;
}

function appendOmittedHint(
	lines: string[],
	omitted: number,
	maxChars: number,
	enabled: boolean,
): void {
	if (!enabled || omitted <= 0) return;
	appendBounded(
		lines,
		[`… ${omitted} more match(es); use responseId for full stored output.`],
		maxChars,
	);
}

function clipLine(value: string): string {
	if (value.length <= MAX_LINE_CHARS) return value;
	return `${value.slice(0, MAX_LINE_CHARS - 1)}…`;
}
