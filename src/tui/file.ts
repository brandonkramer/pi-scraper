/**
 * @file Generic file/binary content-type detection and result card. Used by any tool result whose
 *   envelope carries a non-text payload.
 */
import type { ResultEnvelope } from "../types.ts";
import { renderText } from "./text.ts";
import { muted } from "./theme.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

export function isFileResult(envelope: Partial<ResultEnvelope<unknown>>): boolean {
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
		muted(`File size: ${stringValue(data?.fileSize) ?? "unknown"}`, theme),
		...(data?.mimeType ? [muted(`Mime type: ${stringValue(data.mimeType) ?? ""}`, theme)] : []),
		muted(`File path: ${stringValue(data?.filePath) ?? "unknown"}`, theme),
	];
	return renderText(lines.join("\n"), { padToWidth: true });
}

function stringValue(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}
