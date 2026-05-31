/** @file Pi web_extract vertical result renderer component. */
import type { PiToolShell } from "../../types.ts";
import { failure, muted, success } from "../theme.ts";
import { renderText } from "../tool-call.ts";
import {
	buildToolResultTree,
	splitValueByWidth,
	toolResultTree,
	type ToolResultGroup,
} from "../tool-result-tree.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

interface VerticalBrowserFallbackMetadata {
	browserFallback?: {
		used: boolean;
		backend: string;
	};
}

/** Theme-aware renderer for vertical extractor results. */
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
	const browserFallback = browserFallbackMetadata(wrapper);
	const [metaLine] = extractorPreview(data);
	const check = success("\u2713", theme);
	const summaryDetails = [metaLine, browserFallbackLabel(browserFallback)]
		.filter(Boolean)
		.join(" \u00B7 ");
	const treeLine = `\u2514\u2500 ${check} ${name} done${muted(` \u00B7 ${summaryDetails}`, theme)}`;

	if (!expanded || !data) {
		return renderText(treeLine, { padToWidth: true });
	}

	const sections = buildToolResultTree(buildVerticalSections(data, browserFallback));
	const body = toolResultTree(sections, 80, theme);

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
	const wrappedLines = transcriptLines.flatMap((line) => splitValueByWidth(line, 80));
	const transcriptBlock = wrappedLines
		.map((line) => `${muted("\u2502 ", theme)}${line}`)
		.join("\n");

	const header = `${treeLine}\n${transcriptBlock}`;
	if (!body) return renderText(header, { padToWidth: true });
	return renderText(`${header}\n\n${body}`, { padToWidth: true });
}

function browserFallbackMetadata(
	wrapper: Record<string, unknown> | undefined,
): VerticalBrowserFallbackMetadata["browserFallback"] | undefined {
	const fallback = wrapper?.browserFallback as
		| VerticalBrowserFallbackMetadata["browserFallback"]
		| undefined;
	return fallback?.used ? fallback : undefined;
}

function browserFallbackLabel(
	fallback: VerticalBrowserFallbackMetadata["browserFallback"] | undefined,
): string | undefined {
	return fallback?.used ? `browser fallback · ${fallback.backend}` : undefined;
}

function buildVerticalSections(
	data: Record<string, unknown>,
	browserFallback?: VerticalBrowserFallbackMetadata["browserFallback"],
): ToolResultGroup[] {
	const sections: ToolResultGroup[] = [];
	if (browserFallback?.used) {
		sections.push({
			name: "extraction",
			rows: [
				["path", "browser-prerender \u2192 vertical"],
				["browserBackend", browserFallback.backend],
			],
		});
	}

	const videoRows: ToolResultGroup["rows"] = [];
	if (typeof data.title === "string" && data.title) videoRows.push(["title", data.title]);
	if (typeof data.channel === "string" && data.channel) videoRows.push(["channel", data.channel]);
	if (typeof data.views === "number" && data.views > 0)
		videoRows.push(["views", data.views.toLocaleString()]);
	if (typeof data.lengthSeconds === "number") {
		const m = Math.floor(data.lengthSeconds / 60);
		const s = data.lengthSeconds % 60;
		videoRows.push(["duration", `${m}:${s.toString().padStart(2, "0")}`]);
	}
	if (videoRows.length > 0) sections.push({ name: "video", rows: videoRows });

	const comments = data.comments as
		| Array<{ author?: string; text: string; likeCount?: string }>
		| undefined;
	if (comments && comments.length > 0) {
		const commentRows = comments
			.slice(0, 5)
			.map((comment, index): [string, string] => [
				`${index + 1}`,
				`${comment.author ? `${comment.author}: ` : ""}${comment.text.slice(0, 80)}${comment.text.length > 80 ? "…" : ""}`,
			]);
		if (comments.length > 5) commentRows.push(["…", `${comments.length - 5} more comments`]);
		sections.push({ name: "comments", rows: commentRows });
	}

	const source = data.source as { provider?: string; videoUrl?: string } | undefined;
	if (source) {
		const sourceRows: ToolResultGroup["rows"] = [];
		if (source.provider) sourceRows.push(["provider", source.provider]);
		if (source.videoUrl) sourceRows.push(["url", source.videoUrl]);
		if (sourceRows.length > 0) sections.push({ name: "source", rows: sourceRows });
	}

	return sections;
}

function extractorPreview(data: unknown): [string, string | undefined] {
	const d = data as Record<string, unknown> | undefined;
	if (!d) return ["extracted JSON", undefined];

	const parts: string[] = [];
	if (typeof d.title === "string" && d.title) parts.push(d.title);

	if (typeof d.views === "number" && d.views > 0) {
		parts.push(`${(d.views / 1000000).toFixed(d.views >= 100000000 ? 0 : 1)}M views`);
	} else if (typeof d.views === "string" && d.views) {
		parts.push(`${d.views} views`);
	}

	const transcript = d.transcript as { text?: string; segments?: unknown[] } | undefined;
	if (transcript?.segments) parts.push(`${transcript.segments.length} segments`);
	if (transcript?.text) {
		const text = transcript.text.replaceAll(/\s+/gu, " ").trim();
		const snippet = text.length > 120 ? text.slice(0, 120) + "\u2026" : text;
		return [parts.join(" \u00B7 "), snippet];
	}

	if (typeof d.description === "string" && d.description) {
		const desc = d.description.replaceAll(/\s+/gu, " ").trim();
		const snippet = desc.length > 120 ? desc.slice(0, 120) + "\u2026" : desc;
		parts.push(snippet);
	}

	const comments = d.comments;
	if (Array.isArray(comments) && comments.length > 0) parts.push(`${comments.length} comments`);

	const tracks = d.transcriptTracks;
	if (Array.isArray(tracks) && tracks.length > 1) parts.push(`${tracks.length} languages`);

	return [parts.length > 0 ? parts.join(" \u00B7 ") : "extracted JSON", undefined];
}
