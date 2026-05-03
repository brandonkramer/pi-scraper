export interface PdfMetadata {
	title?: string;
	author?: string;
	subject?: string;
	keywords?: string;
	creator?: string;
	producer?: string;
	creationDate?: string;
	modificationDate?: string;
}

export interface PdfExtractionResult {
	ok: boolean;
	reason?: "unsupported" | "empty" | "failed";
	text?: string;
	pageCount?: number;
	extractedPages?: number;
	truncated?: boolean;
	metadata?: PdfMetadata;
	error?: string;
}

export interface PdfExtractionOptions {
	signal?: AbortSignal;
	maxPages?: number;
	maxTextChars?: number;
	backend?: PdfTextBackend;
}

export interface PdfTextBackend {
	extract(
		input: Uint8Array,
		options: Required<
			Pick<PdfExtractionOptions, "maxPages" | "maxTextChars">
		> & {
			signal?: AbortSignal;
		},
	): Promise<PdfExtractionResult>;
}

const DEFAULT_MAX_PAGES = 250;
const DEFAULT_MAX_TEXT_CHARS = 1_000_000;
const PDFJS_IMPORT = "pdfjs-dist/legacy/build/pdf.mjs";

let pdfjsBackendPromise: Promise<PdfTextBackend> | undefined;

export async function extractPdfText(
	input: Buffer | Uint8Array,
	options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
	const bytes = Buffer.isBuffer(input)
		? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
		: input;
	if (bytes.byteLength === 0) return { ok: false, reason: "empty", text: "" };
	try {
		throwIfAborted(options.signal);
		const backend = options.backend ?? (await getPdfJsBackend());
		return await backend.extract(bytes, {
			maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
			maxTextChars: options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS,
			signal: options.signal,
		});
	} catch (error) {
		if (isAbortError(error)) throw error;
		return errorResult(error);
	}
}

async function getPdfJsBackend(): Promise<PdfTextBackend> {
	pdfjsBackendPromise ??= importPdfJsBackend();
	return pdfjsBackendPromise;
}

async function importPdfJsBackend(): Promise<PdfTextBackend> {
	try {
		const pdfjs = (await import(PDFJS_IMPORT)) as PdfJsModule;
		return new PdfJsBackend(pdfjs);
	} catch (error) {
		return {
			async extract() {
				return {
					ok: false,
					reason: "unsupported",
					text: "PDF text extraction requires the optional pdfjs-dist backend.",
					error:
						error instanceof Error ? error.message : "pdfjs-dist unavailable",
				};
			},
		};
	}
}

class PdfJsBackend implements PdfTextBackend {
	constructor(private readonly pdfjs: PdfJsModule) {}

	async extract(
		input: Uint8Array,
		options: Required<
			Pick<PdfExtractionOptions, "maxPages" | "maxTextChars">
		> & {
			signal?: AbortSignal;
		},
	): Promise<PdfExtractionResult> {
		throwIfAborted(options.signal);
		let document: PdfDocument | undefined;
		try {
			document = await abortable(
				this.pdfjs.getDocument({
					// PDF.js may transfer ownership of the input buffer; keep a bounded copy so callers retain their bytes.
					data: copyBytes(input),
					disableFontFace: true,
					isEvalSupported: false,
					useSystemFonts: false,
					verbosity: this.pdfjs.VerbosityLevel?.ERRORS ?? 0,
				}).promise,
				options.signal,
			);
			const pageCount = document.numPages;
			const extractedPages = Math.min(pageCount, options.maxPages);
			const metadata = await readMetadata(document, options.signal);
			const chunks: string[] = [];
			let chars = 0;
			let truncated = pageCount > extractedPages;
			for (let pageNumber = 1; pageNumber <= extractedPages; pageNumber += 1) {
				throwIfAborted(options.signal);
				const page = await abortable(
					document.getPage(pageNumber),
					options.signal,
				);
				const text = await pageText(page, options.signal);
				if (!text) continue;
				const remaining = options.maxTextChars - chars;
				if (remaining <= 0) {
					truncated = true;
					break;
				}
				const next = text.length > remaining ? text.slice(0, remaining) : text;
				chunks.push(next);
				chars += next.length;
				if (text.length > remaining) {
					truncated = true;
					break;
				}
			}
			const text = normalizePdfText(chunks.join("\n\n"));
			if (!text) {
				return {
					ok: false,
					reason: "empty",
					text: "",
					pageCount,
					extractedPages,
					metadata,
				};
			}
			return { ok: true, text, pageCount, extractedPages, truncated, metadata };
		} finally {
			await document?.destroy?.();
		}
	}
}

async function readMetadata(
	document: PdfDocument,
	signal: AbortSignal | undefined,
): Promise<PdfMetadata | undefined> {
	if (!document.getMetadata) return undefined;
	try {
		const result = await abortable(document.getMetadata(), signal);
		return sanitizeMetadata(result.info);
	} catch {
		return undefined;
	}
}

async function pageText(
	page: PdfPage,
	signal: AbortSignal | undefined,
): Promise<string> {
	const content = await abortable(
		page.getTextContent({ disableNormalization: false }),
		signal,
	);
	return content.items
		.map((item) => (isTextItem(item) ? item.str : ""))
		.filter(Boolean)
		.join(" ");
}

function sanitizeMetadata(info: unknown): PdfMetadata | undefined {
	if (!info || typeof info !== "object") return undefined;
	const source = info as Record<string, unknown>;
	const metadata: PdfMetadata = {
		title: safeString(source.Title),
		author: safeString(source.Author),
		subject: safeString(source.Subject),
		keywords: safeString(source.Keywords),
		creator: safeString(source.Creator),
		producer: safeString(source.Producer),
		creationDate: safeString(source.CreationDate),
		modificationDate: safeString(source.ModDate),
	};
	return Object.fromEntries(
		Object.entries(metadata).filter(([, value]) => value !== undefined),
	) as PdfMetadata;
}

function safeString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
	return normalized ? normalized.slice(0, 500) : undefined;
}

function normalizePdfText(text: string): string {
	return text
		.replace(/\r\n?/gu, "\n")
		.replace(/[\t\f\v ]+/gu, " ")
		.replace(/ *\n */gu, "\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

function errorResult(error: unknown): PdfExtractionResult {
	const message =
		error instanceof Error ? error.message : "PDF extraction failed";
	const lower = message.toLowerCase();
	// Classify encrypted or structurally invalid files as unsupported so callers can distinguish them from transient parser failures.
	if (
		/password|encrypted|invalid pdf structure|missing pdf header/u.test(lower)
	) {
		return { ok: false, reason: "unsupported", text: "", error: message };
	}
	return { ok: false, reason: "failed", text: "", error: message };
}

function copyBytes(input: Uint8Array): Uint8Array {
	return new Uint8Array(input);
}

function isTextItem(item: unknown): item is { str: string } {
	return Boolean(
		item &&
			typeof item === "object" &&
			"str" in item &&
			typeof (item as { str?: unknown }).str === "string",
	);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw abortError();
}

function abortError(): Error {
	const error = new Error("PDF extraction aborted");
	error.name = "AbortError";
	return error;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function abortable<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
): Promise<T> {
	if (!signal) return promise;
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}

interface PdfJsModule {
	getDocument(params: Record<string, unknown>): {
		promise: Promise<PdfDocument>;
	};
	VerbosityLevel?: { ERRORS: number };
}

interface PdfDocument {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPage>;
	getMetadata?(): Promise<{ info?: unknown }>;
	destroy?(): Promise<void> | void;
}

interface PdfPage {
	getTextContent(
		params: Record<string, unknown>,
	): Promise<{ items: unknown[] }>;
}
