/**
 * @fileoverview scrape modes readable module.
 */
import { extractReadable } from "../../parse/page/readable.ts";
import type { ScrapePipelineDeps, ScrapeResult } from "../pipeline.ts";
import { readableIsBetter } from "../signals.ts";

export async function withReadable(
	result: ScrapeResult,
	deps: Pick<ScrapePipelineDeps, "readableExtractor">,
): Promise<ScrapeResult> {
	const html = result.data.html ?? result.data.markdown ?? "";
	const readable = (deps.readableExtractor ?? extractReadable)(
		html,
		result.finalUrl ?? result.url ?? "",
	);
	if (!readableIsBetter(readable, result.data.text?.length ?? 0))
		return { ...result, data: { ...result.data, readable } };
	const text = readable.textContent ?? result.data.text ?? "";
	return {
		...result,
		mode: "readable",
		data: {
			...result.data,
			extractionPath: [...result.data.extractionPath, "readable"],
			readable,
			title: readable.title ?? result.data.title,
			text,
			html: readable.contentHtml ?? result.data.html,
		},
	};
}
