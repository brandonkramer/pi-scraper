/** @fileoverview Deterministic vertical extraction for raw source docstrings. */

import {
	parseDocstrings,
	type ParsedDocstrings,
} from "../../../parse/markup/docstrings.ts";
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

export const docstringsExtractor: VerticalExtractor<ParsedDocstrings> = {
	capability: capability(
		"docstrings",
		[
			"https://:host/:path*.ts",
			"https://:host/:path*.tsx",
			"https://:host/:path*.js",
			"https://:host/:path*.jsx",
			"https://:host/:path*.py",
			"https://:host/:path*.rs",
		],
		docstringsSchema(),
	),
	match: (url) =>
		isSupportedSourceUrl(url) ? { file: url.pathname } : undefined,
	extract: async (url, match, context, signal) => {
		const text = context.fetchPage
			? (await context.fetchPage(url.toString(), signal)).text
			: await context.fetchText?.(url.toString(), signal);
		if (text === undefined)
			throw new Error("docstrings extractor requires text fetch support");
		return parseDocstrings(text, match.file ?? url.pathname);
	},
};

function isSupportedSourceUrl(url: URL): boolean {
	return (
		/^https?:$/u.test(url.protocol) &&
		/\.(?:[cm]?[jt]sx?|py|rs)$/u.test(url.pathname.toLowerCase())
	);
}

function docstringsSchema() {
	return {
		type: "object",
		required: ["file", "exports"],
		properties: {
			file: { type: "string" },
			exports: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						kind: { type: "string" },
						signature: { type: "string" },
						description: { type: "string" },
						parameters: { type: "array", items: { type: "object" } },
						returns: { type: "object" },
						examples: { type: "array", items: { type: "string" } },
					},
				},
			},
		},
	};
}
