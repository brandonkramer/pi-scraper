/** @file Markdown chunking for RAG — paragraph-bounded, token-budgeted segments with overlap. */
import { DEFAULT_CHUNK_MAX_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS } from "../defaults.ts";
import type { Chunk } from "../types.ts";

export type { Chunk };

/** Approximate tokens from character length (matches tool-contract heuristic). */
const CHARS_PER_TOKEN = 4;

export interface ChunkMarkdownOptions {
	maxTokens?: number;
	overlapTokens?: number;
}

export function estimateTokenCount(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Split markdown into paragraph-bounded chunks with optional overlap between consecutive chunks. */
export function chunkMarkdown(markdown: string, options: ChunkMarkdownOptions = {}): Chunk[] {
	const maxTokens = options.maxTokens ?? DEFAULT_CHUNK_MAX_TOKENS;
	const overlapTokens = options.overlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS;
	const normalized = markdown.replaceAll(/\r\n?/gu, "\n").trim();
	if (!normalized) return [];

	const rawChunks = buildParagraphChunks(splitParagraphs(normalized), maxTokens);
	const withOverlap = applyOverlap(rawChunks, overlapTokens);
	return withOverlap.map((text, index) => ({
		text,
		tokenCount: estimateTokenCount(text),
		index,
	}));
}

function splitParagraphs(markdown: string): string[] {
	return markdown
		.split(/\n\n+/u)
		.map((p) => p.trim())
		.filter(Boolean);
}

function buildParagraphChunks(paragraphs: string[], maxTokens: number): string[] {
	const chunks: string[] = [];
	let current: string[] = [];
	let currentTokens = 0;

	const flush = () => {
		if (current.length === 0) return;
		chunks.push(current.join("\n\n"));
		current = [];
		currentTokens = 0;
	};

	for (const paragraph of paragraphs) {
		const paraTokens = estimateTokenCount(paragraph);
		if (paraTokens > maxTokens) {
			flush();
			for (const piece of splitOversizedParagraph(paragraph, maxTokens)) {
				chunks.push(piece);
			}
			continue;
		}

		const separatorTokens = current.length > 0 ? estimateTokenCount("\n\n") : 0;
		if (current.length > 0 && currentTokens + separatorTokens + paraTokens > maxTokens) {
			flush();
		}

		current.push(paragraph);
		currentTokens += separatorTokens + paraTokens;
	}

	flush();
	return chunks;
}

/** Split an oversized paragraph at sentence boundaries, then words, then hard char limit. */
function splitOversizedParagraph(paragraph: string, maxTokens: number): string[] {
	const maxChars = maxTokens * CHARS_PER_TOKEN;
	if (paragraph.length <= maxChars) return [paragraph];

	const sentences = paragraph.split(/(?<=[.!?])\s+/u).filter(Boolean);
	if (sentences.length > 1) {
		return packUnits(sentences, maxTokens, " ");
	}

	const words = paragraph.split(/\s+/u).filter(Boolean);
	if (words.length > 1) {
		return packUnits(words, maxTokens, " ");
	}

	const pieces: string[] = [];
	for (let i = 0; i < paragraph.length; i += maxChars) {
		pieces.push(paragraph.slice(i, i + maxChars));
	}
	return pieces;
}

function packUnits(units: string[], maxTokens: number, joiner: string): string[] {
	const chunks: string[] = [];
	let current: string[] = [];
	let currentTokens = 0;

	const flush = () => {
		if (current.length === 0) return;
		chunks.push(current.join(joiner));
		current = [];
		currentTokens = 0;
	};

	for (const unit of units) {
		const unitTokens = estimateTokenCount(unit);
		if (unitTokens > maxTokens) {
			flush();
			const maxChars = maxTokens * CHARS_PER_TOKEN;
			for (let i = 0; i < unit.length; i += maxChars) {
				chunks.push(unit.slice(i, i + maxChars));
			}
			continue;
		}

		const sepTokens = current.length > 0 ? estimateTokenCount(joiner) : 0;
		if (current.length > 0 && currentTokens + sepTokens + unitTokens > maxTokens) {
			flush();
		}
		current.push(unit);
		currentTokens += sepTokens + unitTokens;
	}

	flush();
	return chunks;
}

function applyOverlap(chunks: string[], overlapTokens: number): string[] {
	if (overlapTokens <= 0 || chunks.length <= 1) return chunks;

	const out: string[] = [chunks[0]];
	for (let i = 1; i < chunks.length; i++) {
		const tail = takeTailForTokens(chunks[i - 1], overlapTokens);
		out.push(tail ? `${tail}\n\n${chunks[i]}` : chunks[i]);
	}
	return out;
}

function takeTailForTokens(text: string, tokenBudget: number): string {
	const maxChars = tokenBudget * CHARS_PER_TOKEN;
	if (maxChars <= 0 || !text) return "";
	if (text.length <= maxChars) return text;
	const slice = text.slice(-maxChars);
	const boundary = slice.search(/\s/u);
	return boundary > 0 ? slice.slice(boundary + 1) : slice;
}
