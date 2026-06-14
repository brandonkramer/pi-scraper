import type { ProgressDetails } from "../types.ts";
import {
	type StatusPillState,
	renderStatusGlyph,
	renderStatusPill,
	paintFirstLineBg,
	statusPillWidth,
	countSegments as c,
} from "./tool-status.ts";
import { muted, renderText } from "./tui.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

type RenderContent = (width: number) => string;
type BooleanOption = "expanded" | "padToWidth" | "hasError";
type TextOption = "summary" | "notice" | "responseId";

/**
 * Formats checklist items without status icons.
 *
 * Example output:
 *
 * ```txt
 * robots.txt checked — allowed
 * ```
 */
export const formatChecklistText = (item: { label: string; detail?: string }): string =>
	`${item.label}${item.detail ? ` — ${item.detail}` : ""}`;

/** Parses the progress start timestamp used to animate loading pills consistently. */
export function progressStartedAtMs(details: ProgressDetails): number | undefined {
	const ms = Date.parse(details.timing?.startedAt ?? "");
	return Number.isFinite(ms) ? ms : undefined;
}

function progressPillLabel(state: string): string {
	if (state === "queued") return "waiting";
	if (state === "processing" || state === "connecting") return "loading";
	return state;
}

/** Maps raw progress states into the smaller pill-state vocabulary. */
export function progressPillState(state: string): StatusPillState {
	const label = progressPillLabel(state);
	return label === "done" || label === "error" || label === "waiting" ? label : "loading";
}

/**
 * Renders a standalone live progress view from a `ProgressDetails` envelope.
 *
 * Direct output, with terminal padding omitted and spinner frame varying:
 *
 * ```txt
 * ⠴ web_map processing 1/3 · https://example.com/sitemap.xml · reading sitemap [ loading ]
 * robots.txt checked
 * sitemap fetch pending
 * 1 succeeded · 0 failed · 0 cache hits
 * ```
 */
export function toolProgressView(
	toolName: `web_${string}`,
	details: ProgressDetails,
	theme?: RenderTheme,
	options?: { allowIcons?: boolean },
): RenderComponent {
	const startedAtMs = progressStartedAtMs(details) ?? Date.now();
	return defineResultRenderer({
		renderContent(width) {
			const state = progressPillState(details.state);
			const count = details.total ? ` ${details.current ?? 0}/${details.total}` : "";
			const message = details.message ? ` · ${details.message}` : "";
			const url = details.url ? ` · ${details.url}` : "";
			const glyph = renderStatusGlyph(state, theme);
			const pill = renderStatusPill({
				label: progressPillLabel(details.state),
				state,
				width: statusPillWidth(width),
				theme,
				startedAtMs,
				restoreBg: "toolPendingBg",
			});
			const lines = [`${glyph} ${toolName} ${details.state}${count}${url}${message} ${pill}`];
			if (details.checklist?.length)
				lines.push(
					...details.checklist.map((item) => progressChecklistText(item, options?.allowIcons)),
				);
			if (details.counts)
				lines.push(progressCountsText(details.counts, options?.allowIcons, theme));
			return lines.filter(Boolean).join("\n");
		},
		padToWidth: true,
	});
}

function progressChecklistText(
	item: NonNullable<ProgressDetails["checklist"]>[number],
	allowIcons = false,
): string {
	if (!allowIcons) return formatChecklistText(item);
	const icon = { done: "✓", failed: "✕", warning: "⚠", pending: "☐", info: "•" }[item.state];
	return `${icon} ${formatChecklistText(item)}`;
}

function progressCountsText(
	counts: NonNullable<ProgressDetails["counts"]>,
	allowIcons = false,
	theme?: RenderTheme,
): string {
	const segment = (val: number | undefined, label: string, render: (v: number) => string) =>
		val === undefined ? undefined : allowIcons ? render(val) : `${val} ${label}`;
	return [
		segment(counts.succeeded, "succeeded", (n) => c.success(n, "succeeded", theme)),
		segment(counts.failed, "failed", (n) => c.failure(n, "failed", theme)),
		segment(counts.cacheHits, "cache hits", (n) => c.activity(n, "cache hits", "ⓞ", theme)),
	]
		.filter(Boolean)
		.join(" · ");
}

/**
 * Builds a Pi render component from a width-aware text renderer.
 *
 * Handles line padding/truncation, optional post-processing, and optional markdown preview append.
 */
export function defineResultRenderer(options: {
	renderContent: RenderContent;
	mapLines?: (lines: string[], width: number) => string[];
	padToWidth?: boolean;
	markdownPreview?: (width: number) => RenderComponent | undefined;
}): RenderComponent {
	return {
		render(width: number) {
			let lines = renderText(options.renderContent(width), {
				padToWidth: options.padToWidth !== false,
			}).render(width);
			if (options.mapLines) lines = options.mapLines(lines, width);
			const md = options.markdownPreview?.(width);
			return md ? [...lines, "", ...md.render(width)] : lines;
		},
		invalidate: () => void 0,
	};
}

type ToolProgressLayoutOptions = Partial<
	Record<TextOption, string> & Record<BooleanOption, boolean>
> & {
	body?: string | RenderContent;
	renderContent?: RenderContent;
	expandedSections?: (width: number) => Array<string | undefined>;
	markdownPreview?: (width: number) => RenderComponent | undefined;
};

/**
 * Generic progress/result layout for body, summary, notice, expanded sections, and responseId.
 *
 * Collapsed output:
 *
 * ```txt
 * ✓ https://example.com [ done ]
 *
 * 200 · fast mode · markdown · fresh fetch
 * ```
 *
 * Expanded output appends notice, details, and responseId sections.
 */
export function toolProgressLayout(
	options: ToolProgressLayoutOptions,
	theme?: RenderTheme,
): RenderComponent {
	return defineResultRenderer({
		renderContent(width) {
			const content = options.renderContent ?? options.body ?? "";
			const body = typeof content === "function" ? content(width) : content;
			const lines = options.summary ? [body, "", options.summary] : [body];
			if (options.notice) lines.push("", muted(options.notice, theme));
			if (!options.expanded) return lines.join("\n");
			for (const section of options.expandedSections?.(width) ?? [])
				if (section) lines.push("", section);
			if (options.responseId) lines.push("", muted(`responseId: ${options.responseId}`, theme));
			return lines.join("\n");
		},
		mapLines: options.hasError
			? (lines) => paintFirstLineBg(lines, "toolErrorBg", theme)
			: undefined,
		padToWidth: options.padToWidth,
		markdownPreview: options.markdownPreview,
	});
}
