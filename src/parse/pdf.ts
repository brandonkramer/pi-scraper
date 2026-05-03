export interface PdfExtractionResult {
  ok: boolean;
  reason?: "unsupported" | "empty" | "failed";
  text?: string;
  pageCount?: number;
}

export async function extractPdfText(_input: Buffer | Uint8Array): Promise<PdfExtractionResult> {
  return {
    ok: false,
    reason: "unsupported",
    text: "PDF text extraction is a parse-layer boundary; install or wire a PDF backend before enabling it.",
  };
}
