/**
 * @fileoverview Shared narrow field accessors for storage rows.
 */
import { normalizeUrl } from "../url/normalize.js";

export function stringField(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function numberField(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

export function normalizeMaybe(url: string): string {
	try {
		return normalizeUrl(url);
	} catch {
		return url;
	}
}
