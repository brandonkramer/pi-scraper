/** @file Generic deterministic source-code docstring extraction primitive. */

import { parseDocstrings, type ParsedDocstrings } from "../../parse/markup/docstrings.ts";
import { capability, type VerticalExtractor } from "./capabilities.ts";
import {
	manifestOptions,
	optionBoolean,
	optionNumber,
	optionStringArray,
} from "./manifest-options.ts";

export const codeDocstringsExtractor: VerticalExtractor<ParsedDocstrings> = {
	capability: capability(
		"code.docstrings",
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
	match: (url) => (isSupportedSourceUrl(url) ? { file: url.pathname } : undefined),
	extract: async (url, match, context, signal) => {
		const options = docstringOptions(manifestOptions(context));
		const file = match.file;
		if (!isAllowedSourceFile(file, options)) return { file, exports: [] };
		const text = context.fetchPage
			? (await context.fetchPage(url.toString(), signal)).text
			: await context.fetchText?.(url.toString(), signal);
		if (text === undefined) throw new Error("docstrings extractor requires text fetch support");
		return applyDocstringOptions(parseDocstrings(text, file), options);
	},
};

interface DocstringOptions {
	languages: string[];
	extensions: string[];
	includePrivate: boolean;
	maxExamples: number;
	maxExports: number;
}

function docstringOptions(options: Record<string, unknown>): DocstringOptions {
	return {
		languages: optionStringArray(options, "languages"),
		extensions: optionStringArray(options, "extensions"),
		includePrivate: optionBoolean(options, "includePrivate", true),
		maxExamples: optionNumber(options, "maxExamples", Number.POSITIVE_INFINITY),
		maxExports: optionNumber(options, "maxExports", Number.POSITIVE_INFINITY),
	};
}

function isSupportedSourceUrl(url: URL): boolean {
	return /^https?:$/u.test(url.protocol) && extensionForPath(url.pathname) !== undefined;
}

function isAllowedSourceFile(file: string, options: DocstringOptions): boolean {
	const extension = extensionForPath(file);
	if (!extension) return false;
	if (options.extensions.length > 0 && !options.extensions.includes(extension)) return false;
	return (
		options.languages.length === 0 || options.languages.includes(languageForExtension(extension))
	);
}

function applyDocstringOptions(
	result: ParsedDocstrings,
	options: DocstringOptions,
): ParsedDocstrings {
	const exports = result.exports
		.filter((item) => options.includePrivate || !item.name.startsWith("_"))
		.slice(0, options.maxExports)
		.map((item) => ({
			...item,
			examples: item.examples?.slice(0, options.maxExamples),
		}));
	return { ...result, exports };
}

function extensionForPath(path: string): string | undefined {
	return path.toLowerCase().match(/\.([cm]?[jt]sx?|py|rs)$/u)?.[1];
}

function languageForExtension(extension: string): string {
	if (extension === "py") return "python";
	if (extension === "rs") return "rust";
	if (extension === "ts" || extension === "tsx") return "typescript";
	return "javascript";
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
