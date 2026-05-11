/** @file Extract verticals ossinsight-collections module. */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";
import { rowsOf, type OssInsightRows } from "./ossinsight-shared.ts";

interface OssInsightCollectionRow {
	id: string | number;
	name: string;
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
	),
	match: (url) => {
		if (url.hostname !== "ossinsight.io") return;
		const parts = url.pathname.split("/").filter(Boolean);
		return parts.length === 1 && parts[0] === "collections" ? {} : undefined;
	},
	extract: async (_url, _match, context, signal) => {
		const payload = await context.fetchJson<OssInsightRows<OssInsightCollectionRow>>(
			"https://api.ossinsight.io/v1/collections/",
			signal,
		);
		return {
			collections: rowsOf(payload).map(({ id, name }) => ({ id, name })),
		};
	},
};
