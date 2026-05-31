/** @file Vertical manifest type definitions. */

export type ManifestKind =
	| "builtin"
	| "api-json"
	| "api-json-aggregate"
	| "api-json-chain"
	| "http-workflow"
	| "api-xml"
	| "selector"
	| "pattern"
	| "recipe"
	| "html-extract"
	| "text-extract"
	| "code-extract";
export type ManifestSource = "builtin" | "user" | "project";

/** URL pattern with named captures like https://example.com/:id */
export interface ManifestUrlPattern {
	pattern: string;
}

export interface ManifestRequest {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	urlTemplate: string;
	/** Query parameters to forward from the input URL. */
	queryPassthrough?: string[];
	/** Template-interpolated query parameters appended to the request URL. */
	queryParams?: Record<string, string>;
	headers?: Record<string, string>;
	/** Request body template for POST/PUT. */
	bodyTemplate?: string;
}

export interface ManifestMatchOptions {
	/** Default values merged into URL captures and query captures. */
	defaults?: Record<string, string>;
	/** Captured values that reject a match, keyed by capture name. */
	exclude?: Record<string, string[]>;
	/** Query parameters to capture with optional source name, defaults, and enum validation. */
	query?: Record<string, { from?: string; default?: string; enum?: string[] }>;
}

export interface ManifestExtractList {
	/** JSONPath-like selector for the array in the response. */
	path: string;
	/** Output field mapping applied to each array item. */
	fields: Record<string, string>;
	/** Output key for the mapped array. Defaults to "items". */
	as?: string;
	/** Drop fields whose extracted values are undefined. */
	omitUndefined?: boolean;
}

export interface ManifestExtractField {
	/** JSONPath-like selector (e.g. $.summary) or constant value. */
	path: string;
	/** Max characters for this field. */
	maxChars?: number;
}

export interface ManifestLimits {
	[field: string]: { maxChars: number };
}

export interface ManifestPreview {
	/** Field to use for the inline preview. */
	field?: string;
	/** Use only the first line of the field. */
	firstLine?: boolean;
}

export interface ManifestRequirements {
	requiresBrowser?: boolean;
	requiresLLM?: boolean;
	requiresCloud?: boolean;
}

export interface ManifestOption {
	type: "string" | "number" | "boolean";
	default?: unknown;
	description?: string;
}

export interface ManifestCapabilities {
	[name: string]: ManifestOption;
}

export type ManifestRecipeProjection =
	| string
	| number
	| boolean
	| null
	| ManifestRecipeProjection[]
	| { [key: string]: ManifestRecipeProjection };

export interface ManifestRecipeStep {
	/** Optional request to run before selecting a step value. */
	request?: ManifestRequest;
	/** Selector applied to the step response. */
	select?: string;
	/** Store the selected value in recipe scope. */
	as?: string;
	/** Find one item from a selected array. */
	find?: {
		where: string;
		equals: string;
		include?: string;
		transform?: "slugVariants";
		errorMessage?: string;
	};
}

export interface ManifestRecipeRequest extends ManifestRequest {
	/** Ignore request failures and expose undefined. */
	optional?: boolean;
	/** Fallback value/projection used when the request fails. */
	fallback?: ManifestRecipeProjection;
}

export interface ManifestRecipeThrowIf {
	/** Selector read from a JSON response/scope. */
	path: string;
	/** Optional fixed error message; defaults to the selected value. */
	message?: string;
}

export interface ManifestRecipe {
	/** Named runtime primitive invoked by a recipe manifest. */
	primitive: string;
	/** Optional primitive profile for generic primitives with host-specific adapters. */
	profile?: string;
	/** Generic cleanup options for text/html extraction recipes. */
	clean?: Record<string, unknown>;
	/** Generic rule-driven output fields. */
	fields?: Record<string, unknown>;
	/** Generic HTTP JSON resource request. */
	request?: ManifestRequest;
	/** Generic HTTP JSON aggregate requests, keyed by scope name. */
	requests?: Record<string, ManifestRecipeRequest>;
	/** Generic HTTP JSON chain steps. */
	steps?: ManifestRecipeStep[];
	/** Throw when a response/scope selector is present. */
	throwIf?: ManifestRecipeThrowIf;
	/** Generic result projection. */
	result?: Record<string, ManifestRecipeProjection>;
	/** Alias for result projections that mirror declarative extract naming. */
	extract?: Record<string, string>;
}

export interface VerticalManifest {
	$schema?: string;
	version: number;
	name: string;
	kind: ManifestKind;
	/** For builtin kinds, the handler reference. */
	handler?: string;
	description: string;
	urlPatterns: string[];
	/** Declarative request config (api-json, api-xml, selector, pattern, text-extract). */
	request?: ManifestRequest;
	/** Parallel JSON requests keyed by scope name (api-json-aggregate). */
	requests?: Record<string, ManifestRecipeRequest>;
	/** Sequential steps (api-json-chain or http-workflow). */
	steps?: Array<ManifestRecipeStep | Record<string, unknown>>;
	/** Throw when a JSON response selector is present (api-json). */
	throwIf?: ManifestRecipeThrowIf;
	/** Rule-driven field specs (html-extract, text-extract). */
	fields?: Record<string, unknown>;
	/** Text cleanup options (text-extract). */
	clean?: Record<string, unknown>;
	/** Parsed source languages (code-extract). */
	languages?: string[];
	/** Allowed file extensions (code-extract). */
	extensions?: string[];
	/** Include private exports (code-extract). */
	includePrivate?: boolean;
	/** Max examples per export (code-extract). */
	maxExamples?: number;
	/** Max exports returned (code-extract). */
	maxExports?: number;
	/** Runtime recipe config for complex extractors that still need bounded TS primitives. */
	recipe?: ManifestRecipe;
	/** Match-time defaults, exclusions, and query captures. */
	matchOptions?: ManifestMatchOptions;
	/**
	 * Field extraction mapping. For api-json: JSONPath/`{{}}` expressions. For api-json-aggregate:
	 * merged-scope projections (`@.`, `{{}}`, transforms).
	 */
	extract?: Record<string, string | ManifestRecipeProjection>;
	/** Array extraction mapping for JSON responses. */
	extractList?: ManifestExtractList;
	/** Scalar wrapper fields for list responses. */
	extractListWrapper?: Record<string, string>;
	limits?: ManifestLimits;
	preview?: ManifestPreview;
	/** Requirements metadata (all kinds). */
	requirements?: ManifestRequirements;
	/** Optional display/match order within a manifest layer. Lower values come first. */
	order?: number;
	/** Capabilities list for display. */
	capabilities?: string[];
	/** Option schema for built-in tools. */
	options?: ManifestCapabilities;
	/** JSON Schema for output (built-in). */
	outputSchema?: unknown;
	/** Source tracking — set by loader. */
	source?: ManifestSource;
	/** File path — set by loader. */
	sourcePath?: string;
	/** If true, user manifest overrides built-in of the same name. */
	override?: boolean;
	/** Validation diagnostics — set by loader. */
	diagnostics?: ManifestDiagnostic[];
}

export interface ManifestDiagnostic {
	severity: "error" | "warning";
	message: string;
	field?: string;
}

export interface ManifestLoadResult {
	manifests: VerticalManifest[];
	errors: ManifestDiagnostic[];
}

export interface ManifestRegistryEntry {
	manifest: VerticalManifest;
	/** Built-in TypeScript extractor, if any. */
	builtin?: unknown;
}
