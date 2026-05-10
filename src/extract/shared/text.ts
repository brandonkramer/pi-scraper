/**
 * @fileoverview Plain-text utilities (no DOM dependency).
 */
export function cleanText(value: unknown): string {
	return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

export function titleCase(value: string): string {
	return value
		.replace(/[-_]+/gu, " ")
		.replace(/\b\w/gu, (char) => char.toUpperCase());
}

export function truncateText(
	value: string | undefined,
	max: number,
): string | undefined {
	if (!value) return undefined;
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function stripUndefined<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(
			([, item]) => item !== undefined && item !== "",
		),
	) as T;
}
