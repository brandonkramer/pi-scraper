/** @file Pi terminal UI preview and metadata formatting primitives. */
import type { PiToolShell, ResultEnvelope } from "../types.ts";
import type { RenderTheme } from "./types.ts";

export function formatPreview(format: string | undefined, content: string): string {
	return format === "json" || format === "html" ? `\`\`\`${format}\n${content}\n\`\`\`` : content;
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

function metadataLine(label: string, value: string, theme?: RenderTheme): string {
	const coloredLabel = theme?.fg?.("syntaxKeyword", `${label}: `) ?? `${label}: `;
	const coloredValue = theme?.fg?.("syntaxString", value) ?? value;
	return `${coloredLabel}${coloredValue}`;
}

/** First non-empty candidate, whitespace-collapsed. Final number arg overrides 180-char cap. */
export function pickExcerpt(
	...args: ReadonlyArray<string | undefined | number>
): string | undefined {
	const mutable = args as Array<string | undefined | number>;
	const maxChars = typeof mutable.at(-1) === "number" ? (mutable.pop() as number) : 180;
	for (const value of mutable as Array<string | undefined>)
		if (value) return value.replaceAll(/\s+/gu, " ").trim().slice(0, maxChars);
}

export function previewText(
	result: PiToolShell,
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
): string {
	const data = envelope.data;
	const value =
		// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
		envelope.answerContext ??
		data?.markdown ??
		data?.text ??
		data?.title ??
		result.content[0]?.text ??
		"";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}
