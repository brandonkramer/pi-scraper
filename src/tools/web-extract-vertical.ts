import { loadEffectiveConfig } from "../config.ts";
import type { VerticalExtractionResult } from "../extract/vertical/capabilities.ts";
import { renderText } from "../tui/text.ts";
import { failure, muted, success } from "../tui/theme.ts";
import { renderTreeSections, type TreeSection } from "../tui/tree.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
/**
 * @file Web_extract action="vertical" and action="list" handlers — deterministic extractor
 *   capabilities and vertical extraction.
 */
import type { PiToolShell } from "../types.ts";
import type { ToolUpdate } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { inputErrorResult, toolResult } from "./infra/result.ts";
import type { Params } from "./web-extract.ts";

export async function listDeterministicExtractors() {
	const { listExtractorCapabilities } = await import("../extract/vertical/registry.ts");
	const capabilities = listExtractorCapabilities();
	return toolResult({
		text: `${capabilities.length} extractor(s): ${capabilities.map((item) => item.name).join(", ")}`,
		data: capabilities,
		format: "json",
		summary: "Listed deterministic extractor capabilities.",
		assistantGuidance:
			"Use action=vertical for supported known sites, action=pattern for deterministic markers/regex/excerpts, and action=adhoc for model-backed schema extraction.",
	});
}

export async function runDeterministicExtractor(
	params: Params,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.extractor || !params.url) {
		return inputErrorResult(
			"EXTRACT_INPUT_MISSING",
			"vertical_extract",
			"web_extract action=vertical requires both extractor and url.",
			"Provide extractor and url for vertical extraction.",
		);
	}
	const extractor: string = params.extractor;
	const url: string = params.url;
	const config = await loadEffectiveConfig();
	await emitProgress(onUpdate, {
		state: "processing",
		url,
		message: `extractor ${extractor}`,
	});
	const { runVerticalExtractor } = await import("../extract/vertical/registry.ts");
	const result = await runVerticalExtractor(
		extractor,
		url,
		{
			requestOptions: {
				cacheTtlSeconds: config.scrapeDefaults.cacheTtlSeconds,
				maxAgeSeconds: config.scrapeDefaults.maxAgeSeconds,
				refresh: config.scrapeDefaults.refresh,
				respectRobots: params.respectRobots,
			},
			onProgress: onUpdate
				? (options) =>
						emitProgress(onUpdate, {
							state: options.state as "waiting" | "loading" | "processing" | "done" | "error",
							message: options.message,
							url: options.url,
						})
				: undefined,
		},
		signal,
	);
	return toolResult({
		text: verticalExtractorText(extractor, result),
		data: result,
		url,
		format: "json",
		sources: result.sources,
		summary: verticalExtractorSummary(extractor, result),
		error: result.error && {
			...result.error,
			phase: "vertical_extract",
			url,
		},
		assistantGuidance: verticalExtractorGuidance(result),
	});
}

/**
 * Theme-aware renderer for vertical extractor results. Called from web_extract's renderResult when
 * the result is from action="vertical".
 */
export function renderVerticalResult(
	result: PiToolShell,
	expanded: boolean | undefined,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Record<string, unknown> | undefined;
	const wrapper = details?.data as Record<string, unknown> | undefined;
	const name = typeof wrapper?.extractor === "string" ? wrapper.extractor : "extractor";
	const isError = Boolean(wrapper?.error ?? details?.error);

	if (isError) {
		const error = (wrapper?.error ?? details?.error) as
			| { code?: string; message?: string }
			| undefined;
		const code = error?.code ?? "FAILED";
		const treeLine = `\u2514\u2500 ${failure("\u2715", theme)} ${name} failed${muted(` \u00B7 ${code}`, theme)}`;
		return renderText(treeLine, { padToWidth: true });
	}

	const data = wrapper?.data as Record<string, unknown> | undefined;
	const [metaLine] = extractorPreview(data);
	const check = success("\u2713", theme);
	const treeLine = `\u2514\u2500 ${check} ${name} done${muted(` \u00B7 ${metaLine}`, theme)}`;

	if (!expanded || !data) {
		return renderText(treeLine, { padToWidth: true });
	}

	// Build expanded sections: transcript as plain text, everything else as tree
	const sections = buildVerticalSections(data);
	const body = renderTreeSections(sections, 80, theme);

	const transcript = data.transcript as
		| {
				languageCode?: string;
				segments?: Array<{ text: string; start: number; duration: number }>;
				text?: string;
		  }
		| undefined;
	if (!transcript?.text) {
		return renderText(`${treeLine}\n${body}`, { padToWidth: true });
	}

	// Render transcript as flowing text with │ continuation, not tree connectors
	const segCount = transcript.segments?.length ?? 0;
	const firstSegments = transcript.segments?.slice(0, 20) ?? [];
	const transcriptLines = firstSegments.map((seg) => {
		const m = Math.floor(seg.start / 60);
		const s = (seg.start % 60).toFixed(0).padStart(2, "0");
		return `[${m}:${s}] ${seg.text}`;
	});
	if (segCount > firstSegments.length) {
		transcriptLines.push(`… ${segCount - firstSegments.length} more segments`);
	}
	const wrappedLines = transcriptLines.flatMap((line) => wrapTranscriptLine(line, 80));
	const transcriptBlock = wrappedLines.map((l) => `${muted("\u2502 ", theme)}${l}`).join("\n");

	const header = `${treeLine}\n${transcriptBlock}`;
	if (!body) return renderText(header, { padToWidth: true });
	return renderText(`${header}\n\n${body}`, { padToWidth: true });
}

function buildVerticalSections(data: Record<string, unknown>): TreeSection[] {
	const sections: TreeSection[] = [];

	// Video info
	const videoRows: TreeSection["rows"] = [];
	if (typeof data.title === "string" && data.title)
		videoRows.push({ key: "title", value: data.title });
	if (typeof data.channel === "string" && data.channel)
		videoRows.push({ key: "channel", value: data.channel });
	if (typeof data.views === "number" && data.views > 0)
		videoRows.push({ key: "views", value: data.views.toLocaleString() });
	if (typeof data.lengthSeconds === "number") {
		const m = Math.floor(data.lengthSeconds / 60);
		const s = data.lengthSeconds % 60;
		videoRows.push({ key: "duration", value: `${m}:${s.toString().padStart(2, "0")}` });
	}
	if (videoRows.length > 0) sections.push({ name: "video", rows: videoRows });

	// Comments
	const comments = data.comments as
		| Array<{ author?: string; text: string; likeCount?: string }>
		| undefined;
	if (comments && comments.length > 0) {
		const commentRows = comments.slice(0, 5).map((c, i) => ({
			key: `${i + 1}`,
			value: `${c.author ? `${c.author}: ` : ""}${c.text.slice(0, 80)}${c.text.length > 80 ? "…" : ""}`,
		}));
		if (comments.length > 5) {
			commentRows.push({ key: "…", value: `${comments.length - 5} more comments` });
		}
		sections.push({ name: "comments", rows: commentRows });
	}

	// Source
	const source = data.source as { provider?: string; videoUrl?: string } | undefined;
	if (source) {
		const sourceRows: TreeSection["rows"] = [];
		if (source.provider) sourceRows.push({ key: "provider", value: source.provider });
		if (source.videoUrl) sourceRows.push({ key: "url", value: source.videoUrl });
		if (sourceRows.length > 0) sections.push({ name: "source", rows: sourceRows });
	}

	return sections;
}

/** Plain-text summary for the call result line (theme applied by renderResult). */
function verticalExtractorSummary(
	extractor: string | undefined,
	result: VerticalExtractionResult,
): string {
	const name = extractor ?? result.extractor;
	const blocked = blockedSource(result.data);
	if (blocked) {
		return `${name} returned URL metadata only (${blocked.reason ?? ""})`;
	}
	if (result.error) {
		return `\u2514\u2500 \u2715 ${name} failed \u00B7 ${result.error.code}`;
	}
	const [metaLine] = extractorPreview(result.data);
	return `\u2514\u2500 \u2713 ${name} done \u00B7 ${metaLine}`;
}

/** Plain-text answer context (theme applied by renderResult). */
function verticalExtractorText(
	extractor: string | undefined,
	result: VerticalExtractionResult,
): string {
	const name = extractor ?? result.extractor;
	const blocked = blockedSource(result.data);
	if (blocked) {
		return [
			`${name} returned URL metadata only (${blocked.reason ?? "structured endpoint unavailable"})`,
			attemptedText(blocked.attemptedEndpoints ?? result.sources?.map((source) => source.url)),
		]
			.filter(Boolean)
			.join("\n");
	}
	if (result.error) {
		return `\u2514\u2500 \u2715 ${name} failed \u00B7 ${result.error.code}`;
	}
	const [metaLine] = extractorPreview(result.data);
	const treePrefix = `\u2514\u2500 \u2713 ${name} done`;

	// Include full transcript text (up to 2000 chars) in the answer context
	const data = result.data as Record<string, unknown> | undefined;
	const transcript = data?.transcript as { text?: string } | undefined;
	if (transcript?.text) {
		const text = transcript.text.replaceAll(/\s+/gu, " ").trim();
		const snippet = text.length > 2000 ? text.slice(0, 2000) + "\u2026" : text;
		return `${treePrefix} \u00B7 ${metaLine}\n\u2502 ${snippet}`;
	}

	return `${treePrefix} \u00B7 ${metaLine}`;
}

/**
 * Build a compact inline preview from common vertical data fields. Returns [metaLine: string,
 * transcriptSnippet?: string].
 */
function extractorPreview(data: unknown): [string, string | undefined] {
	const d = data as Record<string, unknown> | undefined;
	if (!d) return ["extracted JSON", undefined];

	const parts: string[] = [];

	// Title (used by youtube, npm, github, reddit, most verticals)
	if (typeof d.title === "string" && d.title) parts.push(d.title);

	// Views (youtube)
	if (typeof d.views === "number" && d.views > 0) {
		parts.push(`${(d.views / 1000000).toFixed(d.views >= 100000000 ? 0 : 1)}M views`);
	} else if (typeof d.views === "string" && d.views) {
		parts.push(`${d.views} views`);
	}

	// Transcript preview (youtube)
	const transcript = d.transcript as { text?: string; segments?: unknown[] } | undefined;
	if (transcript?.segments) {
		parts.push(`${transcript.segments.length} segments`);
	}
	if (transcript?.text) {
		const text = transcript.text.replaceAll(/\s+/gu, " ").trim();
		const snippet = text.length > 120 ? text.slice(0, 120) + "\u2026" : text;
		return [parts.join(" \u00B7 "), snippet];
	}

	// Description preview fallback (any vertical)
	if (typeof d.description === "string" && d.description) {
		const desc = d.description.replaceAll(/\s+/gu, " ").trim();
		const snippet = desc.length > 120 ? desc.slice(0, 120) + "\u2026" : desc;
		parts.push(snippet);
	}

	// Comments count (youtube, reddit)
	const comments = d.comments;
	if (Array.isArray(comments) && comments.length > 0) {
		parts.push(`${comments.length} comments`);
	}

	// Transcript tracks (youtube)
	const tracks = d.transcriptTracks;
	if (Array.isArray(tracks) && tracks.length > 1) {
		parts.push(`${tracks.length} languages`);
	}

	return [parts.length > 0 ? parts.join(" \u00B7 ") : "extracted JSON", undefined];
}

function verticalExtractorGuidance(result: VerticalExtractionResult): string | undefined {
	const blocked = blockedSource(result.data);
	if (blocked?.reason) return blocked.reason;
	return result.error?.message;
}

function attemptedText(urls: string[] | undefined): string | undefined {
	const uniqueUrls = [...new Set(urls?.filter(Boolean) ?? [])];
	return uniqueUrls.length > 0 ? `attempted:\n  - ${uniqueUrls.join("\n  - ")}` : undefined;
}

function blockedSource(
	data: unknown,
): { blocked?: boolean; reason?: string; attemptedEndpoints?: string[] } | undefined {
	const source = (data as { source?: unknown } | undefined)?.source;
	if (!source || typeof source !== "object") return;
	const typed = source as {
		blocked?: boolean;
		reason?: string;
		attemptedEndpoints?: string[];
	};
	return typed.blocked ? typed : undefined;
}

/** Wrap a transcript line at word boundaries for terminal width. */
function wrapTranscriptLine(line: string, maxChars: number): string[] {
	if (line.length <= maxChars) return [line];
	const lines: string[] = [];
	let remaining = line;
	while (remaining.length > 0) {
		if (remaining.length <= maxChars) {
			lines.push(remaining);
			break;
		}
		let breakAt = remaining.lastIndexOf(" ", maxChars);
		if (breakAt <= 0) breakAt = maxChars;
		lines.push(remaining.slice(0, breakAt));
		remaining = remaining.slice(breakAt).trimStart();
	}
	return lines;
}
