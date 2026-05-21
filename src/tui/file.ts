/**
 * @file Generic file/binary content-type detection and result card. Used by any tool result whose
 *   envelope carries a non-text payload.
 */
import type { ResultEnvelope } from "../types.ts";
import { formatBytes } from "./format.ts";
import { renderText } from "./text.ts";
import { muted } from "./theme.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

const FILE_TYPE_PREFIXES = [
	"application/octet-stream",
	"application/pdf",
	"image/",
	"audio/",
	"video/",
];

export function isFileResult(envelope: Partial<ResultEnvelope<unknown>>): boolean {
	const ct = envelope.contentType ?? "";
	if (FILE_TYPE_PREFIXES.some((p) => ct === p || ct.startsWith(p))) return true;
	return !!(envelope.data && typeof envelope.data === "object" && "fileSize" in envelope.data);
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
