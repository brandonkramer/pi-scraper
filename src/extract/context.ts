/**
 * @fileoverview Compile completed scrape outputs into bounded context.
 *
 * Context files are local, deterministic summaries of already-fetched pages.
 * They never fetch or infer beyond the scrape payload; each entry keeps enough
 * path/title/excerpt structure for downstream LLM context without replacing the
 * raw stored crawl or batch result.
 */
import { PI_TRUNCATION_LIMITS } from "../defaults.ts";
import type { ScrapeResult } from "../scrape/pipeline.ts";

export type ContextSource = "crawl" | "batch";

export interface ContextPage {
	url: string;
	result: ScrapeResult;
	responseId?: string;
}

export interface ContextMetadata {
	source: ContextSource;
	crawlId?: string;
	batchId?: string;
	createdAt: string;
	urlCount: number;
	totalChars: number;
	truncated: boolean;
}

export interface ContextNode {
	url: string;
	title?: string;
	breadcrumbs?: string[];
	summary?: string;
	children?: Array<{ url: string; title?: string }>;
	contentRef?: string;
	excerpt?: string;
}

export interface CompiledContext {
	package: ContextMetadata;
	tree: ContextNode[];
}

export interface CompileContextInput {
	source: ContextSource;
	crawlId?: string;
	batchId?: string;
	pages: readonly ContextPage[];
	createdAt?: string;
	maxBytes?: number;
}

const DEFAULT_EXCERPT_CHARS = 800;
const MIN_EXCERPT_CHARS = 120;
const SUMMARY_CHARS = 220;

export function compileContext(
	input: CompileContextInput,
): CompiledContext {
	const maxBytes = input.maxBytes ?? PI_TRUNCATION_LIMITS.maxBytes;
	const pages = input.pages.filter((page) => !page.result.error);
	const totalChars = pages.reduce(
		(total, page) => total + contentText(page.result).length,
		0,
	);
	const tree = attachChildren(
		pages.map((page) => entryForPage(page, DEFAULT_EXCERPT_CHARS)),
	);
	const base = {
		package: {
			source: input.source,
			crawlId: input.crawlId,
			batchId: input.batchId,
			createdAt: input.createdAt ?? new Date().toISOString(),
			urlCount: pages.length,
			totalChars,
			truncated: false,
		},
		tree,
	} satisfies CompiledContext;
	return boundPackage(base, input, maxBytes);
}

function boundPackage(
	base: CompiledContext,
	input: CompileContextInput,
	maxBytes: number,
): CompiledContext {
	if (byteLength(base) <= maxBytes) return base;
	for (const excerptChars of [400, MIN_EXCERPT_CHARS, 0]) {
		const tree = attachChildren(
			input.pages
				.filter((page) => !page.result.error)
				.map((page) => entryForPage(page, excerptChars)),
		);
		const candidate = {
			...base,
			package: { ...base.package, truncated: true },
			tree,
		};
		if (byteLength(candidate) <= maxBytes) return candidate;
	}
	return truncateEntries(base, maxBytes);
}

function truncateEntries(
	base: CompiledContext,
	maxBytes: number,
): CompiledContext {
	const tree: ContextNode[] = [];
	const packageMeta = { ...base.package, truncated: true };
	for (const entry of base.tree) {
		const compact = withoutUndefined({
			url: entry.url,
			title: entry.title,
			breadcrumbs: entry.breadcrumbs,
			contentRef: entry.contentRef,
		});
		const candidate = { package: packageMeta, tree: [...tree, compact] };
		if (byteLength(candidate) > maxBytes && tree.length > 0) break;
		tree.push(compact);
	}
	return { package: packageMeta, tree };
}

function entryForPage(
	page: ContextPage,
	excerptChars: number,
): ContextNode {
	const result = page.result;
	const url = result.finalUrl ?? result.url ?? page.url;
	const text = contentText(result);
	return withoutUndefined({
		url,
		title: result.data.title,
		breadcrumbs: breadcrumbs(url, result.data.title),
		summary: clipSummary(text),
		contentRef: page.responseId ?? responseIdFromResult(result),
		excerpt: excerptChars > 0 ? clip(text, excerptChars) : undefined,
	});
}

function attachChildren(entries: ContextNode[]): ContextNode[] {
	const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
	for (const entry of entries) {
		const parent = parentUrl(entry.url, byUrl);
		if (!parent) continue;
		const children = parent.children ?? [];
		children.push(withoutUndefined({ url: entry.url, title: entry.title }));
		parent.children = children;
	}
	return entries;
}

function parentUrl(
	url: string,
	entries: Map<string, ContextNode>,
): ContextNode | undefined {
	try {
		const current = new URL(url);
		const parts = current.pathname.split("/").filter(Boolean);
		while (parts.length > 0) {
			parts.pop();
			const parent = new URL(current);
			parent.pathname = parts.length ? `/${parts.join("/")}/` : "/";
			parent.search = "";
			parent.hash = "";
			const match = entries.get(parent.toString());
			if (match && match.url !== url) return match;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function breadcrumbs(url: string, title?: string): string[] | undefined {
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname
			.split("/")
			.filter(Boolean)
			.map((part) => decodeURIComponent(part).replace(/[-_]+/gu, " "));
		const crumbs = [parsed.hostname, ...parts];
		if (title && crumbs.at(-1) !== title) crumbs.push(title);
		return crumbs;
	} catch {
		return title ? [title] : undefined;
	}
}

function contentText(result: ScrapeResult): string {
	const data = result.data;
	if (typeof data.markdown === "string") return data.markdown;
	if (typeof data.text === "string") return data.text;
	if (typeof data.html === "string") return data.html;
	if (data.json !== undefined) return JSON.stringify(data.json) ?? "";
	return "";
}

function clipSummary(text: string): string | undefined {
	const normalized = normalizeText(text);
	return normalized ? clip(normalized, SUMMARY_CHARS) : undefined;
}

function clip(text: string, maxChars: number): string {
	const normalized = normalizeText(text);
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeText(text: string): string {
	return text.replace(/\s+/gu, " ").trim();
}

function responseIdFromResult(result: ScrapeResult): string | undefined {
	return (result as { responseId?: unknown }).responseId as string | undefined;
}

function byteLength(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value));
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}
