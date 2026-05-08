/**
 * @fileoverview serialize json module.
 */
import { normalizeWhitespace } from "./text.js";

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

export function toLlmText(input: { title?: string; description?: string; text?: string; markdown?: string; metadata?: Record<string, unknown> }): string {
  const parts = [
    input.title ? `# ${input.title}` : undefined,
    input.description,
    input.markdown ?? input.text,
    input.metadata && Object.keys(input.metadata).length > 0 ? `Metadata:\n${stableJson(input.metadata)}` : undefined,
  ];
  return normalizeWhitespace(parts.filter(Boolean).join("\n\n"));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)]),
  );
}
