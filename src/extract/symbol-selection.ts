/**
 * @fileoverview Post-parse symbol and section selection for deterministic extraction.
 *
 * The selector works only on already prepared page text/markdown/html so fetch, robots,
 * cache, SSRF, and mode policy remain in the shared scrape/http boundary. It is a
 * lightweight structural pass, not semantic code analysis.
 */

import type { PatternSourceFormat } from "./pattern.ts";

export type SymbolIncludeType =
	| "heading"
	| "code-block"
	| "symbol"
	| "table"
	| "section";

export type ExtractSchemaPreset =
	| "api-reference"
	| "changelog"
	| "faq"
	| "compatibility-table";

export interface SymbolIncludeFilter {
	type: SymbolIncludeType;
	name?: string;
	pattern?: string;
	level?: number;
	language?: string;
}

export interface SymbolSelectionOptions {
	include?: SymbolIncludeFilter[];
	extractSchema?: ExtractSchemaPreset;
	sourceFormat?: PatternSourceFormat;
}

export interface SelectedSection {
	type: "heading" | "section";
	title: string;
	level: number;
	start: number;
	end: number;
	text: string;
}

export interface SelectedCodeBlock {
	type: "code-block";
	language?: string;
	start: number;
	end: number;
	code: string;
}

export interface SelectedTable {
	type: "table";
	start: number;
	end: number;
	text: string;
}

export interface SelectedSymbol {
	type: "symbol";
	name: string;
	kind: "function" | "class" | "interface" | "variable" | "type";
	signature?: string;
	description?: string;
	language?: string;
	start: number;
	end: number;
}

export interface SymbolSelectionResult {
	extractSchema?: ExtractSchemaPreset;
	include: SymbolIncludeFilter[];
	sections: SelectedSection[];
	codeBlocks: SelectedCodeBlock[];
	tables: SelectedTable[];
	symbols: SelectedSymbol[];
	unmatched: SymbolIncludeFilter[];
}

interface ParsedContent {
	headings: SelectedSection[];
	sections: SelectedSection[];
	codeBlocks: SelectedCodeBlock[];
	tables: SelectedTable[];
	symbols: SelectedSymbol[];
}

export function selectSymbolContent(
	content: string,
	options: SymbolSelectionOptions,
): SymbolSelectionResult | undefined {
	const include = normalizedInclude(options);
	if (!include.length) return undefined;
	const parsed = parseSelectableContent(
		content,
		options.sourceFormat ?? "text",
	);
	const sections = uniqueSections([
		...matchesForType(parsed, include, "heading"),
		...matchesForType(parsed, include, "section"),
	]);
	const codeBlocks = uniqueBlocks(
		matchesForType(parsed, include, "code-block"),
	);
	const tables = uniqueTables(matchesForType(parsed, include, "table"));
	const symbols = uniqueSymbols(matchesForType(parsed, include, "symbol"));
	return {
		extractSchema: options.extractSchema,
		include,
		sections,
		codeBlocks,
		tables,
		symbols,
		unmatched: include.filter(
			(filter) => matchCountForFilter(parsed, filter) === 0,
		),
	};
}

function normalizedInclude(
	options: SymbolSelectionOptions,
): SymbolIncludeFilter[] {
	return [...presetInclude(options.extractSchema), ...(options.include ?? [])];
}

function presetInclude(
	preset: ExtractSchemaPreset | undefined,
): SymbolIncludeFilter[] {
	if (preset === "api-reference")
		return [
			{ type: "section", level: 2 },
			{ type: "section", level: 3 },
			{ type: "code-block" },
			{ type: "table" },
		];
	if (preset === "changelog")
		return [
			{ type: "section", pattern: "(^|\\b)(v?\\d+\\.\\d+|changelog|release)" },
		];
	if (preset === "faq")
		return [{ type: "section", pattern: "(faq|question|\\?)$" }];
	if (preset === "compatibility-table")
		return [
			{ type: "table", pattern: "(browser|version|node|support|compat)" },
		];
	return [];
}

function parseSelectableContent(
	content: string,
	sourceFormat: PatternSourceFormat,
): ParsedContent {
	const headings = selectHeadings(content, sourceFormat);
	const sections = sectionsFromHeadings(content, headings);
	const codeBlocks = selectCodeBlocks(content, sourceFormat);
	const tables = extractTables(content, sourceFormat);
	const codeBearingContent =
		codeBlocks.length === 0 && looksCodeBearing(content)
			? symbolsFromCodeBlock({
					type: "code-block",
					code: content,
					start: 0,
					end: content.length,
				})
			: [];
	const symbols = uniqueSymbols([
		...codeBlocks.flatMap((block) => symbolsFromCodeBlock(block)),
		...codeBearingContent,
	]);
	return { headings, sections, codeBlocks, tables, symbols };
}

function selectHeadings(
	content: string,
	sourceFormat: PatternSourceFormat,
): SelectedSection[] {
	const headings: SelectedSection[] = [];
	for (const match of content.matchAll(/^(#{1,6})\s+([^\n#].*)$/gmu)) {
		const title = stripMarkdown(match[2] ?? "").trim();
		headings.push({
			type: "heading",
			title,
			level: match[1]?.length ?? 1,
			start: match.index ?? 0,
			end: (match.index ?? 0) + match[0].length,
			text: title,
		});
	}
	if (sourceFormat === "html") {
		for (const match of content.matchAll(
			/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu,
		)) {
			const title = stripHtml(match[2] ?? "").trim();
			headings.push({
				type: "heading",
				title,
				level: Number(match[1]),
				start: match.index ?? 0,
				end: (match.index ?? 0) + match[0].length,
				text: title,
			});
		}
	}
	return headings.sort((a, b) => a.start - b.start);
}

function sectionsFromHeadings(
	content: string,
	headings: SelectedSection[],
): SelectedSection[] {
	return headings.map((heading, index) => {
		const next = headings
			.slice(index + 1)
			.find((candidate) => candidate.level <= heading.level);
		const end = next?.start ?? content.length;
		return {
			type: "section",
			title: heading.title,
			level: heading.level,
			start: heading.start,
			end,
			text: content.slice(heading.start, end).trim(),
		};
	});
}

function selectCodeBlocks(
	content: string,
	sourceFormat: PatternSourceFormat,
): SelectedCodeBlock[] {
	const blocks: SelectedCodeBlock[] = [];
	for (const match of content.matchAll(/```([^\n`]*)\n([\s\S]*?)```/gu)) {
		const start = match.index ?? 0;
		blocks.push({
			type: "code-block",
			language: (match[1] ?? "").trim() || undefined,
			start,
			end: start + match[0].length,
			code: match[2] ?? "",
		});
	}
	if (sourceFormat === "html") {
		for (const match of content.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/giu)) {
			const start = match.index ?? 0;
			blocks.push({
				type: "code-block",
				language: htmlCodeLanguage(match[0]),
				start,
				end: start + match[0].length,
				code: stripHtml(match[1] ?? ""),
			});
		}
	}
	return blocks.sort((a, b) => a.start - b.start);
}

function extractTables(
	content: string,
	sourceFormat: PatternSourceFormat,
): SelectedTable[] {
	const tables: SelectedTable[] = [];
	for (const match of content.matchAll(/(?:^|\n)((?:\|[^\n]*\|\n?){2,})/gu)) {
		const start = (match.index ?? 0) + (match[0].startsWith("\n") ? 1 : 0);
		tables.push({
			type: "table",
			start,
			end: start + (match[1] ?? "").length,
			text: (match[1] ?? "").trim(),
		});
	}
	if (sourceFormat === "html") {
		for (const match of content.matchAll(
			/<table\b[^>]*>[\s\S]*?<\/table>/giu,
		)) {
			const start = match.index ?? 0;
			tables.push({
				type: "table",
				start,
				end: start + match[0].length,
				text: stripHtml(match[0]).trim(),
			});
		}
	}
	return tables.sort((a, b) => a.start - b.start);
}

function symbolsFromCodeBlock(block: SelectedCodeBlock): SelectedSymbol[] {
	const symbols: SelectedSymbol[] = [];
	const declaration =
		/^(?:(\/\*\*[\s\S]*?\*\/|(?:\s*\/\/\/.*\n)+)\s*)?\s*(?:export\s+)?(?:async\s+)?(function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)\s*([^\n{;]*)/gmu;
	for (const match of block.code.matchAll(declaration)) {
		if (!isCodeDeclaration(match[2], match[4])) continue;
		const relative = match.index ?? 0;
		const start = block.start + relative;
		const rawKind = match[2] ?? "variable";
		const kind =
			rawKind === "const" || rawKind === "let" || rawKind === "var"
				? "variable"
				: rawKind;
		const name = match[3] ?? "";
		const tail = (match[4] ?? "").trim();
		symbols.push({
			type: "symbol",
			name,
			kind: kind as SelectedSymbol["kind"],
			signature: `${rawKind} ${name}${tail}`.trim(),
			description: docDescription(match[1]),
			language: block.language,
			start,
			end: start + match[0].length,
		});
	}
	return symbols;
}

function looksCodeBearing(content: string): boolean {
	const declaration =
		/^\s*(?:export\s+)?(?:async\s+)?(function|class|interface|type|const|let|var)\s+[A-Za-z_$][\w$]*\s*([^\n{;]*)/gmu;
	return [...content.matchAll(declaration)].some((match) =>
		isCodeDeclaration(match[1], match[2]),
	);
}

function isCodeDeclaration(
	kind: string | undefined,
	tail: string | undefined,
): boolean {
	const value = (tail ?? "").trim();
	if (kind === "function") return value.startsWith("(");
	if (kind === "const" || kind === "let" || kind === "var")
		return /^[:=]/u.test(value);
	if (kind === "type") return value.startsWith("=");
	if (kind === "class" || kind === "interface")
		return value === "" || /^(extends|implements)\b/u.test(value);
	return false;
}

function matchesForType<T extends SymbolIncludeType>(
	parsed: ParsedContent,
	include: SymbolIncludeFilter[],
	type: T,
): ExtractedFor<T>[] {
	return include
		.filter((filter) => filter.type === type)
		.flatMap((filter) =>
			collectionForType(parsed, type).filter((item) =>
				matchesFilter(item, filter),
			),
		) as ExtractedFor<T>[];
}

type ExtractedFor<T extends SymbolIncludeType> = T extends "code-block"
	? SelectedCodeBlock
	: T extends "table"
		? SelectedTable
		: T extends "symbol"
			? SelectedSymbol
			: SelectedSection;

function collectionForType<T extends SymbolIncludeType>(
	parsed: ParsedContent,
	type: T,
): ExtractedFor<T>[] {
	if (type === "heading") return parsed.headings as ExtractedFor<T>[];
	if (type === "section") return parsed.sections as ExtractedFor<T>[];
	if (type === "code-block") return parsed.codeBlocks as ExtractedFor<T>[];
	if (type === "table") return parsed.tables as ExtractedFor<T>[];
	return parsed.symbols as ExtractedFor<T>[];
}

function matchCountForFilter(
	parsed: ParsedContent,
	filter: SymbolIncludeFilter,
): number {
	return collectionForType(parsed, filter.type).filter((item) =>
		matchesFilter(item, filter),
	).length;
}

function matchesFilter(
	item: SelectedSection | SelectedCodeBlock | SelectedTable | SelectedSymbol,
	filter: SymbolIncludeFilter,
): boolean {
	if (
		"level" in item &&
		filter.level !== undefined &&
		item.level !== filter.level
	)
		return false;
	if (
		"language" in item &&
		filter.language &&
		item.language !== filter.language
	)
		return false;
	const haystack = searchableText(item);
	if (
		filter.name &&
		!haystack.toLowerCase().includes(filter.name.toLowerCase())
	)
		return false;
	if (filter.pattern && !safePattern(filter.pattern).test(haystack))
		return false;
	return true;
}

function safePattern(pattern: string): RegExp {
	try {
		return new RegExp(pattern, "iu");
	} catch {
		return /$a/u;
	}
}

function searchableText(
	item: SelectedSection | SelectedCodeBlock | SelectedTable | SelectedSymbol,
): string {
	if ("title" in item) return `${item.title}\n${item.text}`;
	if ("code" in item) return `${item.language ?? ""}\n${item.code}`;
	if ("name" in item)
		return `${item.name}\n${item.signature ?? ""}\n${item.description ?? ""}`;
	return item.text;
}

function uniqueSections(items: SelectedSection[]): SelectedSection[] {
	return uniqueBy(items, (item) => `${item.type}:${item.start}:${item.end}`);
}

function uniqueBlocks(items: SelectedCodeBlock[]): SelectedCodeBlock[] {
	return uniqueBy(
		items,
		(item) => `${item.start}:${item.end}:${item.language ?? ""}`,
	);
}

function uniqueTables(items: SelectedTable[]): SelectedTable[] {
	return uniqueBy(items, (item) => `${item.start}:${item.end}`);
}

function uniqueSymbols(items: SelectedSymbol[]): SelectedSymbol[] {
	return uniqueBy(items, (item) => `${item.name}:${item.start}:${item.end}`);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const value = key(item);
		if (seen.has(value)) return false;
		seen.add(value);
		return true;
	});
}

function stripMarkdown(value: string): string {
	return value.replace(/[`*_~[\]()]/gu, "").trim();
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]+>/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
}

function htmlCodeLanguage(value: string): string | undefined {
	return value.match(/language-([A-Za-z0-9_-]+)/u)?.[1];
}

function docDescription(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return value
		.replace(/^\s*\/\*\*|\*\/\s*$/gu, "")
		.replace(/^\s*\* ?/gmu, "")
		.replace(/^\s*\/\/\/ ?/gmu, "")
		.trim();
}
