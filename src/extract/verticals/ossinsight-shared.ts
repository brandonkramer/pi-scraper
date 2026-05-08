/**
 * @fileoverview Shared OSSInsight payload helpers.
 */

export interface OssInsightRows<T> {
	data?: { rows?: T[]; result?: T[] };
}

export function rowsOf<T>(payload: OssInsightRows<T> | T[]): T[] {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload.data?.rows)) return payload.data.rows;
	if (Array.isArray(payload.data?.result)) return payload.data.result;
	return [];
}
