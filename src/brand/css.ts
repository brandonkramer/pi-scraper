export interface FrequencyItem {
  value: string;
  count: number;
}

const COLOR_PATTERN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:black|white|red|green|blue|gray|grey|orange|purple|yellow|pink|teal|navy|maroon)\b/giu;
const FONT_PATTERN = /font-family\s*:\s*([^;}{]+)/giu;

export function extractCssColors(css: string): FrequencyItem[] {
  return topFrequencies([...css.matchAll(COLOR_PATTERN)].map((match) => normalizeCssToken(match[0])), 12);
}

export function extractCssFonts(css: string): FrequencyItem[] {
  const fonts: string[] = [];
  for (const match of css.matchAll(FONT_PATTERN)) {
    const families = (match[1] ?? "").split(",").map(normalizeFontFamily).filter(Boolean);
    fonts.push(...families);
  }
  return topFrequencies(fonts, 12);
}

export function mergeFrequencies(...groups: FrequencyItem[][]): FrequencyItem[] {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const item of group) {
      counts.set(item.value, (counts.get(item.value) ?? 0) + item.count);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function topFrequencies(values: string[], limit: number): FrequencyItem[] {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, limit);
}

function normalizeCssToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function normalizeFontFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/gu, "").replace(/\s+/gu, " ");
}
