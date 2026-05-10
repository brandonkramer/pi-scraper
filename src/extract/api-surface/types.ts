/**
 * @fileoverview API-surface extraction types.
 */

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
