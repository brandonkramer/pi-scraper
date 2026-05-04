import { capability, type VerticalExtractor } from "../capabilities.js";

interface OssInsightCollectionRow {
	id: string | number;
	name: string;
}

interface OssInsightRows<T> {
	data?: { rows?: T[]; result?: T[] };
}

export interface OssInsightCollectionsOutput {
	collections: Array<{ id: string | number; name: string }>;
}

export const ossInsightCollectionsExtractor: VerticalExtractor<OssInsightCollectionsOutput> = {
	capability: capability(
		"ossinsight_collections",
		["https://ossinsight.io/collections", "https://ossinsight.io/collections/"],
		{
			type: "object",
			required: ["collections"],
			properties: {
				collections: {
					type: "array",
					items: {
						type: "object",
						required: ["id", "name"],
						properties: {
							id: { oneOf: [{ type: "string" }, { type: "number" }] },
							name: { type: "string" },
						},
					},
				},
			},
		},
		{ requiresBrowser: false, requiresLLM: false, requiresCloud: false },
	),
	match: (url) => {
		if (url.hostname !== "ossinsight.io") return undefined;
		const parts = url.pathname.split("/").filter(Boolean);
		return parts.length === 1 && parts[0] === "collections" ? {} : undefined;
	},
	extract: async (_url, _match, context, signal) => {
		const payload = await context.fetchJson<OssInsightRows<OssInsightCollectionRow>>(
			"https://api.ossinsight.io/v1/collections/",
			signal,
		);
		return { collections: rowsOf(payload).map(({ id, name }) => ({ id, name })) };
	},
};

function rowsOf<T>(payload: OssInsightRows<T> | T[]): T[] {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload.data?.rows)) return payload.data.rows;
	if (Array.isArray(payload.data?.result)) return payload.data.result;
	return [];
}
