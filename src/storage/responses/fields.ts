/**
 * @fileoverview Shared response field extraction for storage rows.
 */
import { stringField, numberField, normalizeMaybe } from "../db/row-fields.ts";

export function responseFields(value: unknown, responseId: string) {
	const source =
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	const url =
		stringField(source.url) ??
		stringField(source.finalUrl) ??
		`urn:response:${responseId}`;
	const finalUrl = stringField(source.finalUrl);
	return {
		url,
		urlNormalized: normalizeMaybe(url),
		finalUrl,
		status: numberField(source.status),
		mode: stringField(source.mode),
		format: stringField(source.format),
	};
}
