/**
 * @fileoverview Pi terminal UI file result card primitive.
 */
import type { ResultEnvelope } from "../types.js";
import type { RenderComponent, RenderTheme } from "../tools/define.js";
import { muted } from "./theme.js";
import { renderText } from "./text.js";

export function isFileResult(
	envelope: Partial<ResultEnvelope<unknown>>,
): boolean {
	if (
		envelope.contentType === "application/octet-stream" ||
		envelope.contentType === "application/pdf" ||
		envelope.contentType?.startsWith("image/") === true ||
		envelope.contentType?.startsWith("audio/") === true ||
		envelope.contentType?.startsWith("video/") === true
	)
		return true;
	const data = envelope.data;
	if (data && typeof data === "object" && "fileSize" in data) return true;
	return false;
}

export function renderFileResultCard(
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
	theme?: RenderTheme,
): RenderComponent {
	const data = envelope.data;
	const lines = [
		muted(`File size: ${data?.fileSize ?? "unknown"}`, theme),
		...(data?.mimeType ? [muted(`Mime type: ${data.mimeType}`, theme)] : []),
		muted(`File path: ${data?.filePath ?? "unknown"}`, theme),
	];
	return renderText(lines.join("\n"), { padToWidth: true });
}
