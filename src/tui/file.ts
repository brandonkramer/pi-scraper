/**
 * @file Generic file/binary content-type detection and result card. Used by any tool result whose
 *   envelope carries a non-text payload.
 */
import type { ResultEnvelope } from "../types.ts";
import { formatBytes } from "./format.ts";
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
	const fileInfo = (data?.file ?? {}) as {
		path?: string;
		downloadedBytes?: number;
		contentType?: string;
	};
	const fileSize =
		stringValue(data?.fileSize) ?? formatBytes(fileInfo.downloadedBytes) ?? "unknown";
	const filePath = stringValue(data?.filePath) ?? fileInfo.path ?? "unknown";
	const mimeType = stringValue(data?.mimeType) ?? fileInfo.contentType;
	const lines = [
		muted(`File size: ${fileSize}`, theme),
		...(mimeType ? [muted(`Mime type: ${mimeType}`, theme)] : []),
		muted(`File path: ${filePath}`, theme),
	];
	return renderText(lines.join("\n"), { padToWidth: true });
}

function stringValue(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}
