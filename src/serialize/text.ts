export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function linesToText(lines: readonly string[]): string {
  return normalizeWhitespace(lines.filter(Boolean).join("\n"));
}
