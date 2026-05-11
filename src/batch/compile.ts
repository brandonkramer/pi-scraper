import { storeCompiledContext } from "../storage/context/build.ts";
import { updateJobManifest } from "../storage/jobs/manifest.ts";
/** @file Batch context compilation workflow. */
import type { BatchItemResult } from "./run.ts";

export async function compileBatchContext(
	params: { compile?: boolean },
	items: readonly BatchItemResult[],
	jobId: string,
) {
	if (params.compile !== true) return;
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
