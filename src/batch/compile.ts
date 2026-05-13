/** @file Batch context compilation workflow. */
import type { CompiledContext } from "../extract/context.ts";
import type { LineMatch } from "../scrape/line-filter.ts";
import { formatLineMatchPreview } from "../scrape/line-preview.ts";
import { storeCompiledContext } from "../storage/context/build.ts";
import { updateJobManifest } from "../storage/jobs/manifest.ts";
import { storeResponse } from "../storage/responses/store.ts";
import type { BatchItemResult } from "./run.ts";

export interface LabeledTextItem {
	label: string;
	originalUrl: string;
	finalUrl?: string;
	contentType?: string;
	byteLength?: number;
	sha256?: string;
	truncated: boolean;
	text: string;
	matches?: LineMatch[];
}

export async function compileBatchContext(
	params: { compile?: boolean | { mode?: string } },
	items: readonly BatchItemResult[],
	jobId: string,
) {
	const compile = params.compile;
	if (!compile) return;
	const mode = typeof compile === "object" ? compile.mode : undefined;
	if (mode === "labeled-text") {
		const labeled = compileLabeledText(items, jobId);
		const stored = await storeResponse(labeled);
		await updateJobManifest(jobId, {
			responseIds: [stored.responseId],
		});
		return {
			value: labeled,
			responseId: stored.responseId,
			fullOutputPath: stored.fullOutputPath,
		};
	}
	if (compile !== true) return;
	const contextPackage = await storeCompiledContext({
		source: "batch",
		batchId: jobId,
		pages: items
			.filter((item) => item.ok)
			.map((item) => ({
				url: item.result.finalUrl ?? item.result.url ?? item.url,
				result: item.result,
			})),
	});
	await updateJobManifest(jobId, {
		responseIds: [contextPackage.responseId],
	});
	return contextPackage;
}

function compileLabeledText(
	items: readonly BatchItemResult[],
	jobId: string,
): CompiledContext & { items: LabeledTextItem[] } {
	const entries: LabeledTextItem[] = items
		.filter((item): item is BatchItemResult & { ok: true } => item.ok)
		.map((item) => {
			const url = item.result.finalUrl ?? item.result.url ?? item.url;
			return {
				label: labelFromUrl(url),
				originalUrl: item.url,
				finalUrl: item.result.finalUrl,
				contentType: item.result.contentType,
				byteLength: item.result.downloadedBytes,
				sha256: item.result.data.sha256,
				truncated: item.result.truncated,
				text: item.result.data.rawText ?? item.result.data.text ?? item.result.data.html ?? "",
				matches: item.result.data.matches,
			};
		});
	const totalChars = entries.reduce((sum, e) => sum + e.text.length, 0);
	return {
		package: {
			source: "batch",
			batchId: jobId,
			createdAt: new Date().toISOString(),
			urlCount: entries.length,
			totalChars,
			truncated: false,
		},
		tree: entries.map((e) => ({
			url: e.finalUrl ?? e.originalUrl,
			title: e.label,
			excerpt:
				formatLineMatchPreview(e.matches, { maxChars: 300, maxMatches: 2 }) ?? e.text.slice(0, 120),
		})),
		items: entries,
	};
}

function labelFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const name =
			parsed.pathname.split("/").findLast((segment) => segment.length > 0) ?? parsed.hostname;
		return name;
	} catch {
		return url;
	}
}
