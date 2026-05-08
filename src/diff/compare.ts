/**
 * @fileoverview diff compare module.
 */
export interface ChangedTextLine {
  previous: string;
  current: string;
  previousIndex: number;
  currentIndex: number;
  similarity: number;
}

export interface TextDiffSummary {
  added: string[];
  removed: string[];
  changed: ChangedTextLine[];
  unchanged: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
}

interface LineRecord {
  line: string;
  index: number;
}

const CHANGE_SIMILARITY_THRESHOLD = 0.55;

export function compareSnapshotText(previous: string, current: string): TextDiffSummary {
  const previousLines = toLineRecords(previous);
  const currentLines = toLineRecords(current);
  const usedPrevious = new Set<number>();
  const unmatchedCurrent: LineRecord[] = [];
  let unchanged = 0;

  for (const currentLine of currentLines) {
    const exactPrevious = previousLines.find((line) => line.line === currentLine.line && !usedPrevious.has(line.index));
    if (exactPrevious) {
      usedPrevious.add(exactPrevious.index);
      unchanged += 1;
    } else {
      unmatchedCurrent.push(currentLine);
    }
  }

  const unmatchedPrevious = previousLines.filter((line) => !usedPrevious.has(line.index));
  const { changed, usedCurrentIndexes, usedPreviousIndexes } = pairChangedLines(unmatchedPrevious, unmatchedCurrent);
  const added = unmatchedCurrent.filter((line) => !usedCurrentIndexes.has(line.index)).map((line) => line.line);
  const removed = unmatchedPrevious.filter((line) => !usedPreviousIndexes.has(line.index)).map((line) => line.line);

  return {
    added,
    removed,
    changed,
    unchanged,
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
  };
}

function toLineRecords(text: string): LineRecord[] {
  return text.split("\n")
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.length > 0);
}

function pairChangedLines(previousLines: LineRecord[], currentLines: LineRecord[]): {
  changed: ChangedTextLine[];
  usedCurrentIndexes: Set<number>;
  usedPreviousIndexes: Set<number>;
} {
  const usedCurrentIndexes = new Set<number>();
  const usedPreviousIndexes = new Set<number>();
  const changed: ChangedTextLine[] = [];

  for (const previousLine of previousLines) {
    const best = bestChangedMatch(previousLine, currentLines, usedCurrentIndexes);
    if (!best) continue;
    usedPreviousIndexes.add(previousLine.index);
    usedCurrentIndexes.add(best.current.index);
    changed.push({
      previous: previousLine.line,
      current: best.current.line,
      previousIndex: previousLine.index,
      currentIndex: best.current.index,
      similarity: Math.round(best.similarity * 1_000) / 1_000,
    });
  }

  return { changed, usedCurrentIndexes, usedPreviousIndexes };
}

function bestChangedMatch(
  previousLine: LineRecord,
  currentLines: LineRecord[],
  usedCurrentIndexes: Set<number>,
): { current: LineRecord; similarity: number } | undefined {
  let best: { current: LineRecord; similarity: number } | undefined;
  for (const currentLine of currentLines) {
    if (usedCurrentIndexes.has(currentLine.index)) continue;
    const similarity = lineSimilarity(previousLine.line, currentLine.line);
    if (similarity < CHANGE_SIMILARITY_THRESHOLD) continue;
    if (!best || similarity > best.similarity || similarity === best.similarity && currentLine.index < best.current.index) {
      best = { current: currentLine, similarity };
    }
  }
  return best;
}

function lineSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  return Math.max(characterSimilarity(left, right), tokenSimilarity(left, right));
}

function characterSimilarity(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  return maxLength === 0 ? 1 : 1 - levenshteinDistance(left, right) / maxLength;
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokens(line: string): string[] {
  return line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function levenshteinDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previousRow = row[rightIndex] ?? 0;
      const insertion = (row[rightIndex - 1] ?? 0) + 1;
      const deletion = previousRow + 1;
      const substitution = diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      row[rightIndex] = Math.min(insertion, deletion, substitution);
      diagonal = previousRow;
    }
  }
  return row[right.length] ?? 0;
}

