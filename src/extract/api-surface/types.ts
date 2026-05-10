/**
 * @fileoverview API-surface and symbol-selection types.
 */
import type { PatternSourceFormat } from "../pattern/index.ts";

export interface ApiSurfaceParameter {
	name: string;
	type?: string;
	description?: string;
}

export interface ApiSurfaceFunction {
	name: string;
	signature?: string;
	description?: string;
	parameters?: ApiSurfaceParameter[];
	returns?: { type?: string; description?: string };
	examples?: string[];
	url?: string;
}

export interface ApiSurfaceClass {
	name: string;
	description?: string;
	methods?: ApiSurfaceFunction[];
	url?: string;
}

export interface ApiSurfaceModule {
	name: string;
	description?: string;
	url: string;
	functions: ApiSurfaceFunction[];
	classes?: ApiSurfaceClass[];
	errors?: Array<{ code: string; message: string; url?: string }>;
}

export interface ApiSurfaceTree {
	project?: string;
	version?: string;
	modules: ApiSurfaceModule[];
	errors?: Array<{ code: string; message: string; url?: string }>;
	fallback?: { kind: "flat-markdown"; reason: string; pageCount: number };
}

export interface ApiSurfaceInputPage {
	url: string;
	finalUrl?: string;
	title?: string;
	description?: string;
	html?: string;
	markdown?: string;
	text?: string;
	data?: unknown;
	error?: { code: string; message: string };
}

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
