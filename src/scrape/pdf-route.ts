import type { FetchUrlResult } from "../http/client.js";
import { extractPdfText } from "../parse/pdf.js";
import { normalizeWhitespace } from "../serialize/text.js";
import type { OutputFormat, ScrapeMode } from "../types.js";
import type { ScrapeResult } from "./pipeline.js";
import { renderFormat } from "./render.js";

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
