/** @file Parse **tests** pdf.test module. */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractPdfText } from "../content/pdf.ts";

const rootDir = path.resolve(import.meta.dirname, "../../..");
const pdfFixture = path.join(rootDir, "eval/fixtures/pdf-document.pdf");

describe("extractPdfText", () => {
	it("extracts text and page metadata from a text-bearing PDF", async () => {
		const result = await extractPdfText(await readFile(pdfFixture));

		expect(result.ok).toBe(true);
		expect(result.text).toContain("Synthetic PDF");
		expect(result.pageCount).toBe(1);
		expect(result.extractedPages).toBe(1);
	}, 20_000);

	it("returns an empty structured result for zero-byte input", async () => {
		await expect(extractPdfText(new Uint8Array())).resolves.toMatchObject({
			ok: false,
			reason: "empty",
			text: "",
		});
	});

	it("returns a structured non-ok result for malformed PDFs", async () => {
		const result = await extractPdfText(Buffer.from("%PDF malformed"));

		expect(result.ok).toBe(false);
		expect(["unsupported", "failed"]).toContain(result.reason);
		expect(result.text).toBe("");
	});

	it("honors text truncation limits", async () => {
		const result = await extractPdfText(await readFile(pdfFixture), {
			maxTextChars: 9,
		});

		expect(result.ok).toBe(true);
		expect(result.text).toBe("Synthetic");
		expect(result.truncated).toBe(true);
	}, 20_000);

	it("propagates AbortSignal cancellation", async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			extractPdfText(await readFile(pdfFixture), { signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});
