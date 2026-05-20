/** @file Pi tool adapter for stored result, job, and snapshot lookup. */
import { type Static, Type } from "typebox";

import { listSnapshots } from "../diff/snapshots.ts";
import { getJobManifest } from "../storage/jobs/manifest.ts";
import { readResponse } from "../storage/responses/read.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { renderText } from "../tui/text.ts";
import { inlineThemeText } from "../tui/theme.ts";
import { renderTreeSections, type TreeSection } from "../tui/tree.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import type { PiToolShell } from "../types.ts";
import { defineWebTool } from "./infra/define.ts";
import { errorResult, structuredToolError, toolResult } from "./infra/result.ts";

export const webGetResultSchema = Type.Object({
	responseId: Type.Optional(Type.Any()),
	jobId: Type.Optional(Type.Any()),
	snapshotUrl: Type.Optional(Type.Any()),
	snapshotName: Type.Optional(Type.Any()),
	snapshotTag: Type.Optional(Type.Any()),
});

type Params = Static<typeof webGetResultSchema>;

export const webGetResultTool = defineWebTool({
	name: "web_get_result",
	label: "Get",
	description: "Retrieve stored response or job manifest",
	parameters: webGetResultSchema,
	async execute(_toolCallId, params: Params) {
		if (params.jobId) return await getJob(params.jobId);
		if (params.responseId) return await getResponse(params.responseId);
		if (params.snapshotUrl)
			return await getSnapshotList(params.snapshotUrl, params.snapshotName, params.snapshotTag);
		return errorResult({
			code: "GET_RESULT_INPUT_MISSING",
			phase: "retrieve",
			message: "Provide responseId, jobId, or snapshotUrl.",
			retryable: false,
		});
	},
	renderCall: (args, theme) =>
		renderSimpleCall(
			"web_get_result",
			[
				args.jobId ? `job:${String(args.jobId)}` : args.responseId,
				args.snapshotUrl ? `snapshots:${String(args.snapshotUrl)}` : undefined,
			],
			theme,
		),
	renderResult: (result, { expanded }, theme) => renderGetResult(result, expanded ?? false, theme),
});

async function getJob(jobId: string) {
	try {
		const { manifest, path } = await getJobManifest(jobId);
		return toolResult({
			text: `Job ${manifest.jobId}: ${manifest.jobType} ${manifest.status} · ${manifest.urlsProcessed} processed · ${manifest.urlsFailed} failed`,
			data: manifest,
			format: "json",
			fullOutputPath: path,
			responseId: manifest.jobId,
			summary: `Retrieved ${manifest.jobType} job manifest ${manifest.jobId}.`,
			answerContext:
				"This is a local job manifest with counters, sanitized params, errors, and stored response references. It does not inline page content.",
		});
	} catch (error) {
		return errorResult(structuredToolError(error, "JOB_MANIFEST_NOT_FOUND", "retrieve"));
	}
}

async function getSnapshotList(snapshotUrl: string, snapshotName?: string, snapshotTag?: string) {
	try {
		const entries = await listSnapshots({
			url: snapshotUrl,
			snapshotName,
			snapshotTag,
		});
		return toolResult({
			text: `Found ${entries.length} snapshot(s) for ${snapshotUrl}`,
			data: entries,
			format: "json",
			summary: `Listed ${entries.length} snapshot(s) for ${snapshotUrl}.`,
			answerContext:
				"Snapshot listings include local paths plus metadata such as timestamp, mode, snapshotName, and snapshotTag for selecting web_scrape diff compareTag baselines.",
		});
	} catch (error) {
		return errorResult(structuredToolError(error, "SNAPSHOT_LIST_FAILED", "retrieve", snapshotUrl));
	}
}

async function getResponse(responseId: string) {
	try {
		const stored = await readResponse(responseId);
		return toolResult({
			text: `Stored result ${responseId}: ${summarizeData(stored.value)}`,
			data: stored.value,
			format: stored.metadata.contentType?.includes("json") ? "json" : undefined,
			responseId,
			fullOutputPath: stored.metadata.fullOutputPath,
			contentType: stored.metadata.contentType,
			summary: `Retrieved stored response ${responseId}.`,
		});
	} catch (error) {
		return errorResult(structuredToolError(error, "STORED_RESULT_NOT_FOUND", "retrieve"));
	}
}

function summarizeData(value: unknown): string {
	if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (value && typeof value === "object")
		return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
	if (value === null || value === undefined) return "done";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

/**
 * Render web_get_result with a summary header and a field tree in expanded view. The inline text
 * becomes the description in the tree header.
 */
const HIDDEN_ENVELOPE_KEYS = new Set([
	"_stored",
	"__id",
	"format",
	"contentType",
	"fullOutputPath",
	"text",
	"sources",
	"citations",
	"sourceNotes",
	"modelUsage",
	"nextActions",
	"assistantGuidance",
	"kind",
	"snapshotSaved",
	"diagnostics",
	"cache",
	"freshness",
	"qualitySignals",
	"headers",
	"downloadedBytes",
	"timing",
	"summary",
	"answerContext",
	"finalUrl",
	"error",
]);

const ENVELOPE_KEY_DESCRIPTIONS: Record<string, string> = {
	text: "summary",
	data: "response payload",
	url: "source URL",
	responseId: "stored response ID",
	jobId: "job identifier",
	summary: "overview",
	answerContext: "agent context",
	source: "source label",
};

function describeField(key: string): string | undefined {
	return ENVELOPE_KEY_DESCRIPTIONS[key];
}

function renderGetResult(
	result: PiToolShell,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const envelope = result.details as Record<string, unknown> | undefined;

	const section: TreeSection = { name: "result", rows: [] };
	const summary = typeof envelope?.summary === "string" ? envelope.summary : "";
	const shortSummary = summary.replace(/ [0-9a-f-]{36}\.?$/u, "");
	const DISPLAY_ORDER = ["truncated", "responseId", "data", "url"];

	const fieldMap = new Map<string, string>();
	for (const [key, value] of Object.entries(envelope ?? {})) {
		if (HIDDEN_ENVELOPE_KEYS.has(key)) continue;
		if (value === null || value === undefined) continue;
		if (typeof value === "string" && !value) continue;
		const desc = describeField(key);
		let val: string;
		if (typeof value === "string") {
			val = value.slice(0, 80);
		} else if (Array.isArray(value)) {
			val = `${value.length} item${value.length === 1 ? "" : "s"}`;
		} else if (typeof value === "object") {
			const keys = Object.keys(value);
			val = `${keys.length} field${keys.length === 1 ? "" : "s"}`;
		} else if (
			typeof value === "number" ||
			typeof value === "boolean" ||
			typeof value === "bigint"
		) {
			val = String(value);
		} else {
			val = "[unknown]";
		}
		fieldMap.set(key, desc ? `${val} (${desc})` : val);
	}

	for (const key of DISPLAY_ORDER) {
		if (fieldMap.has(key)) {
			section.rows.push({ key, value: fieldMap.get(key)! });
			fieldMap.delete(key);
		}
	}
	for (const [key, value] of fieldMap) {
		section.rows.push({ key, value });
	}

	const sections = section.rows.length > 0 ? [section] : [];

	return {
		render(width: number) {
			const lines: string[] = [
				`└─ ${inlineThemeText("accent", "✓", theme) ?? "✓"} ${shortSummary}`,
			];
			if (expanded && sections.length > 0) {
				const tree = renderTreeSections(sections, width, theme);
				if (tree) lines.push("", ...tree.split("\n"));
			}
			return renderText(lines.join("\n"), { padToWidth: true }).render(width);
		},
		invalidate() {
			/* no-op */
		},
	};
}
