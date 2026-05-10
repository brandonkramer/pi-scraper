/**
 * @fileoverview Pi terminal UI preview and metadata formatting primitives.
 */
import type { PiToolShell, ResultEnvelope } from "../types.ts";
import type { RenderTheme } from "./types.ts";
import { inlineThemeText, muted } from "./theme.ts";

export function formatPreview(
	format: string | undefined,
	content: string,
): string {
	if (format === "json") return `\`\`\`json\n${content}\n\`\`\``;
	if (format === "html") return `\`\`\`html\n${content}\n\`\`\``;
	return content;
}

export function renderMetadataLines(
	data: Record<string, unknown> | undefined,
	theme?: RenderTheme,
): string {
	if (!data) return "";
	const fields: Array<[string, unknown]> = [
		["Title", data.title],
		["Published", data.published],
		["Author", data.author],
		["Description", data.description],
	];
	const lines = fields
		.filter(([, value]) => typeof value === "string" && value.length > 0)
		.map(([label, value]) => metadataLine(label, String(value), theme));
	return lines.join("\n");
}

function metadataLine(
	label: string,
	value: string,
	theme?: RenderTheme,
): string {
	const coloredLabel =
		theme?.fg?.("syntaxKeyword", `${label}: `) ?? `${label}: `;
	const coloredValue = theme?.fg?.("syntaxString", value) ?? value;
	return `${coloredLabel}${coloredValue}`;
}

export function previewText(
	result: PiToolShell,
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
): string {
	const data = envelope.data;
	return String(
		envelope.answerContext ??
			data?.markdown ??
			data?.text ??
			data?.title ??
			result.content[0]?.text ??
			"",
	);
}
