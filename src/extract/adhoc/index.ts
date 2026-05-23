/** @file Ad-hoc extraction public entrypoint. */
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";
import type { ModelAdapter } from "../adhoc/model.ts";
import { groundExtractionResult } from "../grounding.ts";
import { prepareExtractionInput } from "../input.ts";
import {
	type AdHocExtractOptions,
	type AdHocExtractResult,
	MissingExtractInputError,
} from "./types.ts";

export { MissingExtractInputError };
export type { AdHocExtractOptions, AdHocExtractResult };

export async function extractAdHoc<T = unknown>(
	options: AdHocExtractOptions,
	model: ModelAdapter,
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<AdHocExtractResult<T>> {
	const prepared = await prepareExtractionInput(options, deps, signal);
	const response = await model.run<T>(
		{
			task: "extract",
			input: prepared.content,
			prompt: options.prompt,
			schema: options.schema,
		},
		signal,
	);
	const grounded = groundExtractionResult(response.data, prepared.content);
	return {
		input: prepared.input,
		data: response.data,
		grounded,
		raw: response.raw,
		usage: response.usage,
	};
}
