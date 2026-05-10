/**
 * @fileoverview Symbol-selection types.
 */
import type { PatternSourceFormat } from "../pattern/index.ts";

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
