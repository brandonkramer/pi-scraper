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

type BrowserFallback = { used: boolean; backend: string };

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
		const error = (wrapper?.error ?? details?.error) as { code?: string } | undefined;
		const code = error?.code ?? "FAILED";
		const treeLine = `\u2514\u2500 ${failure("\u2715", theme)} ${name} failed${muted(` \u00B7 ${code}`, theme)}`;
		return renderText(treeLine, { padToWidth: true });
	}

	const data = wrapper?.data as Record<string, unknown> | undefined;
	const bfFallback = wrapper?.browserFallback as BrowserFallback | undefined;
	const browserFallback = bfFallback?.used ? bfFallback : undefined;
	const metaLine = extractorPreview(data);
	const check = success("\u2713", theme);
	const summaryDetails = [
		metaLine,
		browserFallback?.used ? `browser fallback · ${browserFallback.backend}` : undefined,
	]
		.filter(Boolean)
		.join(" \u00B7 ");
	const treeLine = `\u2514\u2500 ${check} ${name} done${muted(` \u00B7 ${summaryDetails}`, theme)}`;

	if (!expanded || !data) {
		return renderText(treeLine, { padToWidth: true });
	}

	const sections = buildToolResultTree(buildVerticalSections(data, browserFallback));
	const body = toolResultTree(sections, 80, theme);

	const transcript = data.transcript as
		| { segments?: { text: string; start: number; duration: number }[]; text?: string }
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

function buildVerticalSections(
	data: Record<string, unknown>,
	browserFallback?: BrowserFallback,
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

	const comments = data.comments as { author?: string; text: string }[] | undefined;
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

function extractorPreview(data: unknown): string {
	const d = data as Record<string, unknown> | undefined;
	if (!d) return "extracted JSON";
	const trans = d.transcript as { text?: string; segments?: unknown[] } | undefined;
	return (
		[
			typeof d.title === "string" && d.title ? d.title : undefined,
			typeof d.views === "number" && d.views > 0
				? `${(d.views / 1000000).toFixed(d.views >= 100000000 ? 0 : 1)}M views`
				: typeof d.views === "string" && d.views
					? `${d.views} views`
					: undefined,
			trans?.segments ? `${trans.segments.length} segments` : undefined,
			!trans?.text && typeof d.description === "string" && d.description
				? d.description.replaceAll(/\s+/gu, " ").trim().slice(0, 120) +
					(d.description.length > 120 ? "\u2026" : "")
				: undefined,
			Array.isArray(d.comments) && d.comments.length > 0
				? `${d.comments.length} comments`
				: undefined,
			Array.isArray(d.transcriptTracks) && d.transcriptTracks.length > 1
				? `${d.transcriptTracks.length} languages`
				: undefined,
		]
			.filter(Boolean)
			.join(" \u00B7 ") || "extracted JSON"
	);
}
