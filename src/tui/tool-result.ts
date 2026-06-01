import type { ToolContext } from "../types.ts";
import { formatBytes } from "./tool-resource.ts";
import type { ToolResultTreeSection } from "./tool-result-tree.ts";
import { muted, renderDynamicText } from "./tui.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

type FileResult = { path?: string; downloadedBytes?: number; contentType?: string };

/** Stored-result handle displayed in expanded output. */
export type ToolResultIdEntry = { label: string; id: string };

/**
 * Renders the embedded file details block for file-like scrape results.
 *
 * Direct output, with terminal padding omitted:
 *
 * ```txt
 * File size: 13 KB
 * Mime type: application/pdf
 * File path: /tmp/dummy.pdf
 * ```
 *
 * The surrounding scrape result layout owns the URL row, summary, and responseId.
 */
export function toolResultFileDetails(
	envelope: Partial<ToolContext<Record<string, unknown>>>,
	theme?: RenderTheme,
): RenderComponent {
	const data = envelope.data;
	const file = (data?.file ?? {}) as FileResult;
	const fileSize = stringValue(data?.fileSize) ?? formatBytes(file.downloadedBytes) ?? "unknown";
	const filePath = stringValue(data?.filePath) ?? file.path ?? "unknown";
	const mimeType = stringValue(data?.mimeType) ?? file.contentType;
	return renderDynamicText(
		() =>
			[
				`File size: ${fileSize}`,
				...(mimeType ? [`Mime type: ${mimeType}`] : []),
				`File path: ${filePath}`,
			]
				.map((line) => muted(line, theme))
				.join("\n"),
		{ padToWidth: true },
	);
}

/** Converts primitive/JSON-like values to display strings while preserving missing values. */
export function stringValue(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

/**
 * Renders stored handle lines, omitting empty ids.
 *
 * Example output:
 *
 * ```txt
 * responseId: r-demo
 * jobId: j-demo
 * ```
 */
export const toolResultId = (entries: ToolResultIdEntry[], theme?: RenderTheme): string[] =>
	entries.filter((e) => e.id).map((e) => muted(`${e.label}: ${e.id}`, theme));

/** Keys hidden from generic expanded-result details because specialized UI owns them. */
export const DEFAULT_HIDDEN_EXPANDED_KEYS = new Set(
	"_stored __id format contentType fullOutputPath text sources citations sourceNotes modelUsage nextActions assistantGuidance kind snapshotSaved diagnostics cache freshness qualitySignals headers downloadedBytes timing summary answerContext finalUrl error".split(
		" ",
	),
);

/** Human descriptions appended to common generic expanded-result keys. */
export const DEFAULT_EXPANDED_KEY_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
	"text=summary,data=response payload,url=source URL,responseId=stored response ID,jobId=job identifier,summary=overview,answerContext=agent context,source=source label"
		.split(",")
		.map((p) => p.split("=") as [string, string]),
);

/** Preferred display order before any remaining generic details are appended. */
export const DEFAULT_EXPANDED_DISPLAY_ORDER = ["truncated", "responseId", "data", "url"] as const;

/**
 * Converts expanded-result values into compact human-readable summaries.
 *
 * Examples: `2 fields`, `3 items`, `true`, or a clipped string value.
 */
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

/**
 * Builds generic expanded-result tree sections from a result details object.
 *
 * Example row output after `toolResultTree`:
 *
 * ```txt
 *   result
 *   ├─ responseId  r-demo (stored response ID)
 *   └─ data        2 fields (response payload)
 * ```
 */
export function buildToolResultDetails(
	data: Record<string, unknown> | undefined,
	options: {
		hide?: ReadonlySet<string>;
		describe?: Record<string, string>;
		order?: readonly string[];
		sectionName?: string;
	} = {},
): ToolResultTreeSection[] {
	const hide = options.hide ?? DEFAULT_HIDDEN_EXPANDED_KEYS;
	const describe = options.describe ?? DEFAULT_EXPANDED_KEY_DESCRIPTIONS;
	const order = options.order ?? DEFAULT_EXPANDED_DISPLAY_ORDER;

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
			rows.push({ key, value: fieldMap.get(key)! });
			fieldMap.delete(key);
		}
	for (const [key, value] of fieldMap) rows.push({ key, value });
	return [{ name: options.sectionName ?? "result", rows }];
}
