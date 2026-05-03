import { type Static, Type } from "@mariozechner/pi-ai";
import { loadCrawlMetadata } from "../crawl/state.js";
import { getSnapshot, listSnapshots } from "../diff/snapshots.js";
import type { ResolveStorageOptions } from "../storage/paths.js";
import { getStoredResult } from "../storage/results.js";
import { defineWebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { structuredToolError, toolResult } from "./result.js";

export const webGetResultSchema = Type.Object({
	responseId: Type.Optional(
		Type.String({
			description:
				"Stored response id returned by crawl, batch, diff, or large scrape results.",
		}),
	),
	crawlId: Type.Optional(
		Type.String({
			description:
				"Persisted crawl id whose status metadata should be retrieved from local crawl storage.",
		}),
	),
	snapshotUrl: Type.Optional(
		Type.String({
			description:
				"Optional URL whose web_diff snapshot metadata should be retrieved or listed.",
		}),
	),
	snapshotName: Type.Optional(
		Type.String({
			description:
				"Optional named web_diff snapshot baseline, such as homepage.",
		}),
	),
	listSnapshots: Type.Optional(
		Type.Boolean({
			description:
				"List web_diff snapshot metadata instead of retrieving one stored response.",
		}),
	),
});

type Params = Static<typeof webGetResultSchema>;

export interface WebGetResultDeps {
	storage?: ResolveStorageOptions;
}

export function createWebGetResultTool(deps: WebGetResultDeps = {}) {
	return defineWebTool({
		name: "web_get_result",
		label: "Web Get Result",
		description:
			"Retrieve full locally stored output by responseId, crawl status metadata by crawlId, or web_diff snapshot metadata by URL/name.",
		parameters: webGetResultSchema,
		async execute(_toolCallId, params: Params) {
			if (params.responseId)
				return getByResponseId(params.responseId, deps.storage);
			if (params.crawlId) return getByCrawlId(params.crawlId, deps.storage);
			if (params.listSnapshots) return getSnapshotList(params, deps.storage);
			if (params.snapshotUrl) return getSnapshotMetadata(params, deps.storage);
			return missingIdentifier();
		},
		renderCall: (args, theme) =>
			renderSimpleCall("web_get_result", [renderLookupLabel(args)], theme),
		renderResult: (result, { expanded }) =>
			renderEnvelopeResult(result, expanded),
	});
}

export const webGetResultTool = createWebGetResultTool();

async function getByResponseId(
	responseId: string,
	storage?: ResolveStorageOptions,
) {
	try {
		const stored = await getStoredResult(responseId, storage);
		return toolResult({
			text: `Retrieved ${responseId}`,
			data: stored.value,
			responseId: stored.metadata.responseId,
			fullOutputPath: stored.metadata.fullOutputPath,
			contentType: stored.metadata.contentType,
		});
	} catch (resultError) {
		const structured = structuredToolError(
			resultError,
			"RESULT_NOT_FOUND",
			"storage",
		);
		return toolResult({
			text: `Result not found: ${responseId}`,
			data: undefined,
			responseId,
			error: structured,
		});
	}
}

async function getByCrawlId(crawlId: string, storage?: ResolveStorageOptions) {
	try {
		const metadata = await loadCrawlMetadata(crawlId, storage);
		const done = metadata.succeededCount + metadata.failedCount;
		return toolResult({
			text: `Crawl ${crawlId}: ${metadata.status} · ${done} page(s) processed · ${metadata.failedCount} failed · frontier ${metadata.frontierCount}`,
			data: metadata,
			url: metadata.seedUrl,
			responseId: metadata.responseId,
		});
	} catch (resultError) {
		const structured = structuredToolError(
			resultError,
			"CRAWL_STATUS_NOT_FOUND",
			"storage",
		);
		return toolResult({
			text: `Crawl status not found: ${crawlId}`,
			data: undefined,
			error: structured,
		});
	}
}

async function getSnapshotMetadata(
	params: Params,
	storage?: ResolveStorageOptions,
) {
	const snapshotUrl = params.snapshotUrl ?? "";
	try {
		const snapshot = await getSnapshot(snapshotUrl, {
			...storage,
			snapshotName: params.snapshotName,
		});
		if (!snapshot) return snapshotNotFound(snapshotUrl, params.snapshotName);
		return toolResult({
			text: `Retrieved snapshot metadata for ${snapshot.metadata.url}${snapshot.metadata.snapshotName ? ` (${snapshot.metadata.snapshotName})` : ""}`,
			data: snapshot,
			url: snapshot.metadata.url,
			finalUrl: snapshot.metadata.finalUrl,
			mode: snapshot.metadata.mode,
			format: "json",
			fullOutputPath: snapshot.snapshotPath,
			contentType: "application/json",
		});
	} catch (resultError) {
		const structured = structuredToolError(
			resultError,
			"SNAPSHOT_LOOKUP_FAILED",
			"storage",
			snapshotUrl,
		);
		return toolResult({
			text: structured.message,
			data: undefined,
			url: snapshotUrl,
			error: structured,
		});
	}
}

async function getSnapshotList(
	params: Params,
	storage?: ResolveStorageOptions,
) {
	try {
		const snapshots = await listSnapshots({
			...storage,
			url: params.snapshotUrl,
			snapshotName: params.snapshotName,
		});
		return toolResult({
			text: `${snapshots.length} snapshot(s)${params.snapshotUrl ? ` for ${params.snapshotUrl}` : ""}`,
			data: { snapshots },
			url: params.snapshotUrl,
			format: "json",
			contentType: "application/json",
		});
	} catch (resultError) {
		const structured = structuredToolError(
			resultError,
			"SNAPSHOT_LIST_FAILED",
			"storage",
			params.snapshotUrl,
		);
		return toolResult({
			text: structured.message,
			data: undefined,
			url: params.snapshotUrl,
			error: structured,
		});
	}
}

function missingIdentifier() {
	return toolResult({
		text: "Provide responseId, crawlId, snapshotUrl, or listSnapshots.",
		data: undefined,
		error: {
			code: "RESULT_IDENTIFIER_MISSING",
			phase: "storage",
			message:
				"web_get_result requires responseId, crawlId, snapshotUrl, or listSnapshots.",
			retryable: false,
		},
	});
}

function snapshotNotFound(snapshotUrl: string, snapshotName?: string) {
	const label = snapshotName ? `${snapshotUrl} (${snapshotName})` : snapshotUrl;
	const error = structuredToolError(
		new Error(`Snapshot not found: ${label}`),
		"SNAPSHOT_NOT_FOUND",
		"storage",
		snapshotUrl,
	);
	return toolResult({
		text: error.message,
		data: undefined,
		url: snapshotUrl,
		error,
	});
}

function renderLookupLabel(args: Params): string {
	if (args.responseId) return args.responseId;
	if (args.crawlId) return args.crawlId;
	if (args.snapshotUrl)
		return args.snapshotName
			? `${args.snapshotUrl} (${args.snapshotName})`
			: args.snapshotUrl;
	if (args.listSnapshots) return "snapshots";
	return "missing id";
}
