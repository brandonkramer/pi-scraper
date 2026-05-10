/**
 * @fileoverview scrape pdf-route module.
 */
import type { FetchUrlResult } from "../http/client.ts";
import { extractPdfText } from "../parse/pdf.ts";
import { normalizeWhitespace } from "../serialize/text.ts";
import type { OutputFormat, ScrapeMode } from "../types.ts";
import type { ScrapeResult } from "./pipeline.ts";
import { renderFormat } from "./render.ts";

export async function pdfResult(
	base: ScrapeResult,
	body: Buffer | Uint8Array,
	file: FetchUrlResult["file"],
	format: OutputFormat,
	mode: ScrapeMode,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	const pdf = await extractPdfText(body, { signal });
	const text = pdf.ok ? normalizeWhitespace(pdf.text ?? "") : "";
	const metadata = { pdf } satisfies Record<string, unknown>;
	const rendered = renderFormat(format, {
		text,
		markdown: text,
		metadata,
	});
	return {
		...base,
		data: {
			route: "pdf",
			extractionPath: [mode],
			file,
			pdf,
			metadata,
			...rendered,
		},
	};
}
