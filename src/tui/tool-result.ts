import type { PiToolShell, ToolContext } from "../types.ts";
import { muted } from "./theme.ts";
import type { ToolResultTreeSection } from "./tool-result-tree.ts";
import type { RenderTheme } from "./types.ts";
/** @file Pi terminal UI preview and metadata formatting primitives. */

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
	envelope: Partial<ToolContext<Record<string, unknown>>>,
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

export interface ToolResultIdEntry {
	label: string;
	id: string;
}

export function toolResultId(entries: ToolResultIdEntry[], theme?: RenderTheme): string[] {
	return entries.filter((e) => e.id).map((e) => muted(`${e.label}: ${e.id}`, theme));
}

// ── Expanded result details ───────────────────────────────────────

export const DEFAULT_HIDDEN_EXPANDED_KEYS = new Set(
	"_stored __id format contentType fullOutputPath text sources citations sourceNotes modelUsage nextActions assistantGuidance kind snapshotSaved diagnostics cache freshness qualitySignals headers downloadedBytes timing summary answerContext finalUrl error".split(
		" ",
	),
);

export const DEFAULT_EXPANDED_KEY_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
	"text=summary,data=response payload,url=source URL,responseId=stored response ID,jobId=job identifier,summary=overview,answerContext=agent context,source=source label"
		.split(",")
		.map((p) => p.split("=") as [string, string]),
);

export const DEFAULT_EXPANDED_DISPLAY_ORDER = ["truncated", "responseId", "data", "url"] as const;

export interface BuildExpandedDetailsOptions {
	hide?: ReadonlySet<string>;
	describe?: Record<string, string>;
	order?: readonly string[];
	sectionName?: string;
}

export function stringifyExpandedValue(value: unknown): string {
	if (typeof value === "string") return value.slice(0, 80);
	if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (value && typeof value === "object") {
		const k = Object.keys(value).length;
		return `${k} field${k === 1 ? "" : "s"}`;
	}
	const t = typeof value;
	return t === "number" || t === "boolean" || t === "bigint" ? String(value) : "[unknown]";
}

export function buildExpandedResultDetails(
	data: Record<string, unknown> | undefined,
	options: BuildExpandedDetailsOptions = {},
): ToolResultTreeSection[] {
	const hide = options.hide ?? DEFAULT_HIDDEN_EXPANDED_KEYS;
	const describe = options.describe ?? DEFAULT_EXPANDED_KEY_DESCRIPTIONS;
	const order = options.order ?? DEFAULT_EXPANDED_DISPLAY_ORDER;
	const sectionName = options.sectionName ?? "result";

	const fieldMap = new Map<string, string>();
	for (const [key, value] of Object.entries(data ?? {})) {
		if (hide.has(key) || value === null || value === undefined) continue;
		if (typeof value === "string" && !value) continue;
		const val = stringifyExpandedValue(value);
		fieldMap.set(key, describe[key] ? `${val} (${describe[key]})` : val);
	}

	const rows: ToolResultTreeSection["rows"] = [];
	for (const key of order)
		if (fieldMap.has(key)) {
			const val = fieldMap.get(key)!;
			rows.push({ key, value: val });
			fieldMap.delete(key);
		}
	for (const [key, value] of fieldMap) rows.push({ key, value });
	return [{ name: sectionName, rows }];
}
