import { type DomAdapter, loadDom } from "../parse/dom-adapter.js";
import { extractBrandAssets, type BrandAsset } from "./assets.js";
import {
	extractCssColors,
	extractCssFonts,
	mergeFrequencies,
	type FrequencyItem,
} from "./css.js";

export interface BrandIdentity {
	url: string;
	name?: string;
	description?: string;
	themeColors: string[];
	colors: FrequencyItem[];
	fonts: FrequencyItem[];
	assets: BrandAsset[];
	manifest?: BrandManifest;
	openGraph: Record<string, string>;
	twitter: Record<string, string>;
	schema: BrandSchemaEntity[];
	metadata: Record<string, string>;
}

export interface BrandExtractOptions {
	manifestJson?: string;
}

export interface BrandManifest {
	name?: string;
	shortName?: string;
	themeColor?: string;
	backgroundColor?: string;
	icons: BrandAsset[];
}

export interface BrandSchemaEntity {
	type?: string | string[];
	name?: string;
	url?: string;
	logo?: unknown;
	sameAs?: unknown;
}

export function extractBrandIdentity(
	html: string,
	url: string,
	options: BrandExtractOptions = {},
): BrandIdentity {
	return extractBrandIdentityFromDom(loadDom(html), url, options);
}

export function extractBrandIdentityFromDom(
	dom: DomAdapter,
	url: string,
	options: BrandExtractOptions = {},
): BrandIdentity {
	const metadata = metaMap(dom);
	const openGraph = prefixed(metadata, "og:");
	const twitter = prefixed(metadata, "twitter:");
	const schema = extractSchemaEntities(dom);
	const manifest = parseManifest(options.manifestJson, url);
	const css = collectCss(dom);
	const styleText = dom
		.nodes(dom.select("[style]"))
		.map((node) => dom.attr(node, "style") ?? "")
		.join(";");
	const inlineColors = extractCssColors(styleText);
	const inlineFonts = extractCssFonts(styleText);
	const themeColorValues = [
		...themeColors(dom),
		manifest?.themeColor,
		manifest?.backgroundColor,
	].filter(Boolean) as string[];
	return {
		url,
		name:
			schema.find((item) => item.name)?.name ??
			manifest?.name ??
			manifest?.shortName ??
			openGraph.site_name ??
			openGraph.title ??
			metadata["application-name"] ??
			(clean(dom.text(dom.first(dom.select("title")))) || undefined),
		description:
			metadata.description ?? openGraph.description ?? twitter.description,
		themeColors: themeColorValues,
		colors: mergeFrequencies(
			extractCssColors(css),
			inlineColors,
			extractCssColors(themeColorValues.join(" ")),
		),
		fonts: mergeFrequencies(extractCssFonts(css), inlineFonts),
		assets: [...extractBrandAssets(dom, url), ...(manifest?.icons ?? [])],
		manifest,
		openGraph,
		twitter,
		schema,
		metadata,
	};
}

function metaMap(dom: DomAdapter): Record<string, string> {
	const map: Record<string, string> = {};
	for (const node of dom.nodes(dom.select("meta"))) {
		const key =
			dom.attr(node, "name") ??
			dom.attr(node, "property") ??
			dom.attr(node, "http-equiv");
		const content = dom.attr(node, "content");
		if (key && content) map[key] = content;
	}
	return map;
}

function prefixed(
	input: Record<string, string>,
	prefix: string,
): Record<string, string> {
	const output: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) {
		if (key.startsWith(prefix)) output[key.slice(prefix.length)] = value;
	}
	return output;
}

function themeColors(dom: DomAdapter): string[] {
	return dom
		.nodes(dom.select('meta[name="theme-color"][content]'))
		.map((node) => dom.attr(node, "content")?.trim())
		.filter(Boolean) as string[];
}

function collectCss(dom: DomAdapter): string {
	return dom
		.nodes(dom.select("style"))
		.map((node) => dom.text(node))
		.join("\n");
}

function extractSchemaEntities(dom: DomAdapter): BrandSchemaEntity[] {
	const entities: BrandSchemaEntity[] = [];
	for (const node of dom.nodes(
		dom.select('script[type="application/ld+json"]'),
	)) {
		const parsed = safeJson(dom.text(node));
		for (const item of flattenJsonLd(parsed)) {
			const type = item["@type"];
			const types = Array.isArray(type) ? type : [type];
			if (
				types.some((entry) => entry === "Organization" || entry === "WebSite")
			) {
				entities.push({
					type: schemaType(type),
					name: stringValue(item.name),
					url: stringValue(item.url),
					logo: item.logo,
					sameAs: item.sameAs,
				});
			}
		}
	}
	return entities;
}

function flattenJsonLd(value: unknown): Array<Record<string, unknown>> {
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
	const record = value as Record<string, unknown>;
	const graph = record["@graph"];
	return [record, ...flattenJsonLd(graph)];
}

function parseManifest(
	text: string | undefined,
	baseUrl: string,
): BrandManifest | undefined {
	const manifest = safeJson(text ?? "") as Record<string, unknown> | undefined;
	if (!manifest) return undefined;
	return {
		name: stringValue(manifest.name),
		shortName: stringValue(manifest.short_name),
		themeColor: stringValue(manifest.theme_color),
		backgroundColor: stringValue(manifest.background_color),
		icons: Array.isArray(manifest.icons)
			? manifest.icons.flatMap((icon) => manifestIcon(icon, baseUrl))
			: [],
	};
}

function manifestIcon(value: unknown, baseUrl: string): BrandAsset[] {
	if (!value || typeof value !== "object") return [];
	const record = value as Record<string, unknown>;
	const src = stringValue(record.src);
	if (!src) return [];
	try {
		return [
			{
				url: new URL(src, baseUrl).toString(),
				kind: "icon",
				type: stringValue(record.type),
				source: "manifest",
			},
		];
	} catch {
		return [];
	}
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function schemaType(value: unknown): string | string[] | undefined {
	if (typeof value === "string") return value;
	if (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "string")
	) {
		return value;
	}
	return undefined;
}

function clean(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}
