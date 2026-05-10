/**
 * @fileoverview Batch context-package compilation workflow.
 */
import type { BatchItemResult } from "./run.ts";
import { buildStoredContextPackage } from "../storage/context-package-results.ts";
import { updateJobManifest } from "../storage/jobs.ts";

export async function buildBatchContextPackage(
	params: { compile?: boolean },
	items: readonly BatchItemResult[],
	jobId: string,
) {
	if (params.compile !== true) return undefined;
	const contextPackage = await buildStoredContextPackage({
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
