/**
 * @file Pure-TS cosine similarity / TF-IDF relevance scoring. Given a query and text content,
 *   splits into blocks, builds TF-IDF vectors, ranks by cosine similarity to the query, and returns
 *   the top-N most relevant blocks. No ML/runtime dependencies — pure string/vector math.
 */

// ─── Tokenizer ──────────────────────────────────────────────────────────────

/** Split text into normalized tokens (lowercase, stripped punctuation). */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replaceAll(/[^a-z0-9\s'-]/gu, " ")
		.split(/\s+/u)
		.filter((t) => t.length > 1);
}

// ─── Term frequency (within a single document/block) ────────────────────────

function termFreq(tokens: string[]): Map<string, number> {
	const tf = new Map<string, number>();
	for (const t of tokens) {
		tf.set(t, (tf.get(t) ?? 0) + 1);
	}
	// Normalize by total tokens so longer blocks don't dominate
	for (const [k, v] of tf) {
		tf.set(k, v / tokens.length);
	}
	return tf;
}

// ─── Inverse document frequency (across all blocks) ─────────────────────────

function inverseDocFreq(blockTokens: string[][]): Map<string, number> {
	const n = blockTokens.length;
	const df = new Map<string, number>();
	for (const tokens of blockTokens) {
		const seen = new Set(tokens);
		for (const t of seen) {
			df.set(t, (df.get(t) ?? 0) + 1);
		}
	}
	const idf = new Map<string, number>();
	for (const [term, count] of df) {
		idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
	}
	return idf;
}

// ─── TF-IDF vector ──────────────────────────────────────────────────────────

function buildVector(tokens: string[], idf: Map<string, number>, vocab: string[]): Float64Array {
	const vec = new Float64Array(vocab.length);
	const tf = termFreq(tokens);
	for (let i = 0; i < vocab.length; i++) {
		const term = vocab[i];
		vec[i] = (tf.get(term) ?? 0) * (idf.get(term) ?? 0);
	}
	return vec;
}

// ─── Cosine similarity ──────────────────────────────────────────────────────

function cosineSim(a: Float64Array, b: Float64Array): number {
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	return denom === 0 ? 0 : dot / denom;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ScoredBlock {
	/** Block index in the original text. */
	index: number;
	/** Block text content. */
	text: string;
	/** Cosine similarity score (0–1). */
	score: number;
	/** Approximate character range in the original. */
	charStart: number;
	charEnd: number;
}

export interface SimilarityResult {
	/** Top-N scored blocks. */
	blocks: ScoredBlock[];
	/** Total blocks scored. */
	totalBlocks: number;
	/** Query used for scoring. */
	query: string;
}

/**
 * Split text into blocks and score each against query using TF-IDF cosine similarity.
 *
 * @param text — raw text content to search within
 * @param query — search query
 * @param topN — max results (default 5)
 * @param minScore — minimum score to include (default 0.0)
 * @param blockSize — approximate block size in chars (default 512)
 */
export function scoreTextByCosine(
	text: string,
	query: string,
	topN = 5,
	minScore = 0.0,
	blockSize = 512,
): SimilarityResult {
	const blocks = splitBlocks(text, blockSize);
	const blockTexts = blocks.map((b) => b.text);
	const blockTokens = blockTexts.map((b) => tokenize(b));
	const queryTokens = tokenize(query);

	if (blockTokens.length === 0 || queryTokens.length === 0) {
		return { blocks: [], totalBlocks: 0, query };
	}

	const idf = inverseDocFreq(blockTokens);
	const vocab = [...new Set([...queryTokens, ...blockTokens.flat()])].toSorted();
	const queryVec = buildVector(queryTokens, idf, vocab);

	const scored: ScoredBlock[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const blockVec = buildVector(blockTokens[i], idf, vocab);
		const score = cosineSim(queryVec, blockVec);
		if (score >= minScore) {
			scored.push({
				index: i,
				text: blockTexts[i],
				score,
				charStart: blocks[i].start,
				charEnd: blocks[i].end,
			});
		}
	}

	scored.sort((a, b) => b.score - a.score);
	const top = scored.slice(0, topN);

	return { blocks: top, totalBlocks: blocks.length, query };
}

// ─── Block splitting ────────────────────────────────────────────────────────

interface TextBlock {
	text: string;
	start: number;
	end: number;
}

function splitBlocks(text: string, targetSize: number): TextBlock[] {
	if (!text) return [];
	if (text.length <= targetSize) {
		return [{ text, start: 0, end: text.length }];
	}

	const blocks: TextBlock[] = [];
	let start = 0;
	while (start < text.length) {
		let end = Math.min(start + targetSize, text.length);
		// Try to break at paragraph or sentence boundary
		if (end < text.length) {
			const after = text.slice(end, Math.min(end + 200, text.length));
			const paraBreak = after.search(/\n\s*\n/u);
			if (paraBreak >= 0 && paraBreak < 100) {
				end += paraBreak + 2;
			} else {
				const sentenceBreak = after.search(/[.!?]\s/u);
				if (sentenceBreak >= 0 && sentenceBreak < 50) {
					end += sentenceBreak + 1;
				}
			}
		}
		blocks.push({
			text: text.slice(start, end).trim(),
			start,
			end,
		});
		start = end;
	}
	return blocks.filter((b) => b.text.length > 0);
}
