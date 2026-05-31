/** @file Declarative vertical extractor runtime for API JSON/XML, selector, and pattern manifests. */
import { cleanText } from "../../text.ts";
import type { VerticalExtractor, VerticalExtractorContext } from "../capabilities.ts";
import { capability } from "../capabilities.ts";
import { codeDocstringsExtractor } from "../primitives/code-docstrings.ts";
import { codeExtractOptions } from "../primitives/recipe-options.ts";
import { applyMatchOptions, matchManifestUrl } from "./matcher.ts";
import { runApiJsonAggregateManifest, runApiJsonChainManifest } from "./recipe-http.ts";
import { runRuleRecipe } from "./recipe-rules.ts";
import { runHttpWorkflowManifest } from "./recipe-workflow.ts";
import { runRecipeManifest } from "./recipe.ts";
import type { ManifestRequest, VerticalManifest } from "./types.ts";
export { matchUrlPattern } from "./matcher.ts";

type Values = Record<string, string>;
type ResponseFormat = "json" | "xml";

export function createDeclarativeExtractor(manifest: VerticalManifest): VerticalExtractor {
	return {
		capability: manifestToCapability(manifest),
		match: (url) => matchManifestUrl(manifest, url),
		extract: (url, match, context, signal) =>
			runDeclarativeExtraction(manifest, url, match, context, signal),
	};
}

function manifestToCapability(manifest: VerticalManifest) {
	return capability(
		manifest.name,
		manifest.urlPatterns,
		manifest.outputSchema ??
			(manifest.extract
				? {
						type: "object",
						properties: Object.fromEntries(
							Object.entries(manifest.extract).map(([key]) => [key, { type: "string" }]),
						),
					}
				: { type: "object" }),
		{
			requiresBrowser: manifest.requirements?.requiresBrowser ?? false,
			requiresLLM: manifest.requirements?.requiresLLM ?? false,
			requiresCloud: manifest.requirements?.requiresCloud ?? false,
		},
	);
}

async function runDeclarativeExtraction(
	manifest: VerticalManifest,
	url: URL,
	match: Values,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	if (manifest.kind === "api-json") {
		return await runApiJsonManifest(manifest, url, match, context, signal);
	}
	if (manifest.kind === "api-json-aggregate") {
		return await runApiJsonAggregateManifest(manifest, url, match, context, signal);
	}
	if (manifest.kind === "api-json-chain") {
		return await runApiJsonChainManifest(manifest, url, match, context, signal);
	}
	if (manifest.kind === "http-workflow") {
		return await runHttpWorkflowManifest(manifest, url, match, context, signal);
	}
	if (manifest.kind === "api-xml") {
		return await runApiXmlManifest(manifest, url, match, context, signal);
	}
	if (manifest.kind === "selector") {
		return await runSelectorManifest(manifest, url, match, context, signal);
	}
	if (manifest.kind === "pattern") {
		return await runPatternManifest(manifest, url, match, context, signal);
	}
	if (manifest.kind === "html-extract" || manifest.kind === "text-extract") {
		return await runRuleRecipe(manifest, url, match, context, signal);
	}
	if (manifest.kind === "code-extract") {
		const primitiveMatch = codeDocstringsExtractor.match(url) ?? match;
		return await codeDocstringsExtractor.extract(
			url,
			primitiveMatch,
			{
				...context,
				recipe: codeExtractOptions(manifest),
			},
			signal,
		);
	}
	if (manifest.kind === "recipe") {
		return await runRecipeManifest(manifest, url, match, context, signal);
	}
	throw new Error(`Unsupported declarative kind: ${manifest.kind}`);
}

async function runApiJsonManifest(
	manifest: VerticalManifest,
	url: URL,
	match: Values,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const values = applyMatchOptions(url, match, manifest.matchOptions) ?? match;
	const response = await fetchJsonRequest(manifest.request!, url, values, context, signal);
	throwIfConfigured(manifest, response);
	return buildJsonResult(manifest, response, values);
}

function throwIfConfigured(manifest: VerticalManifest, response: unknown): void {
	const config = manifest.throwIf;
	if (!config) return;
	const value = extractJsonPath(
		response,
		config.path.startsWith("$") ? config.path : `$.${config.path}`,
	);
	if (value === undefined || value === null || value === "") return;
	const message =
		typeof config.message === "string"
			? config.message
			: typeof value === "string"
				? value
				: JSON.stringify(value);
	throw new Error(message);
}

async function runApiXmlManifest(
	manifest: VerticalManifest,
	url: URL,
	match: Values,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const values = applyMatchOptions(url, match, manifest.matchOptions) ?? match;
	const request = manifest.request!;
	const fetchUrl = buildRequestUrl(request, url, values);
	const text = await context.fetchText?.(fetchUrl, signal);
	if (text === undefined) throw new Error("fetchText not available for api-xml manifest");
	return buildExtractResult(manifest.extract ?? {}, text, values, "xml");
}

async function fetchJsonRequest(
	request: ManifestRequest,
	url: URL,
	values: Values,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const finalUrl = buildRequestUrl(request, url, values);
	const method = request.method ?? "GET";
	const hasCustomConfig =
		method !== "GET" || request.headers !== undefined || request.bodyTemplate !== undefined;
	if (hasCustomConfig && context.fetch) {
		const body = request.bodyTemplate
			? expandTemplate(request.bodyTemplate, values, url)
			: undefined;
		const response = await context.fetch(
			finalUrl,
			{ method, headers: request.headers, body },
			signal,
		);
		return response.data;
	}
	return await context.fetchJson<unknown>(finalUrl, signal);
}

function buildRequestUrl(request: ManifestRequest, url: URL, values: Values): string {
	const requestUrl = new URL(expandTemplate(request.urlTemplate, values, url));
	for (const name of request.queryPassthrough ?? []) {
		const value = url.searchParams.get(name);
		if (value) requestUrl.searchParams.set(name, value);
	}
	for (const [name, template] of Object.entries(request.queryParams ?? {})) {
		requestUrl.searchParams.set(name, expandTemplate(template, values, url));
	}
	return requestUrl.toString();
}

function buildJsonResult(
	manifest: VerticalManifest,
	response: unknown,
	values: Values,
): Record<string, unknown> {
	const extract = manifest.extract ?? {};
	const result = applyResultLimits(
		buildExtractResult(extract as Record<string, string>, response, values, "json"),
		manifest,
	);
	if (!manifest.extractList) return result;
	const list = extractJsonPath(response, manifest.extractList.path);
	const items = Array.isArray(list) ? list : [];
	const rows = items.map((item) =>
		buildExtractResult(manifest.extractList?.fields ?? {}, item, values, "json", {
			omitUndefined: manifest.extractList?.omitUndefined ?? false,
		}),
	);
	const wrapper = buildExtractResult(manifest.extractListWrapper ?? {}, response, values, "json");
	return { ...wrapper, [manifest.extractList.as ?? "items"]: rows };
}

function buildExtractResult(
	extract: Record<string, string>,
	response: unknown,
	values: Values,
	format: ResponseFormat,
	options: { omitUndefined?: boolean } = {},
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [field, expression] of Object.entries(extract)) {
		const value = evaluateExpression(response, expression, values, format);
		if (value === undefined && options.omitUndefined) continue;
		result[field] = value;
	}
	return result;
}

function applyResultLimits(
	result: Record<string, unknown>,
	manifest: Pick<VerticalManifest, "limits">,
): Record<string, unknown> {
	if (!manifest.limits) return result;
	const limited = { ...result };
	for (const [field, limit] of Object.entries(manifest.limits)) {
		const value = limited[field];
		if (typeof value === "string" && value.length > limit.maxChars) {
			limited[field] = value.slice(0, limit.maxChars);
		}
	}
	return limited;
}

function buildSelectorResult(
	extract: Record<string, string>,
	html: string,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [field, selector] of Object.entries(extract)) {
		result[field] = extractSimpleSelector(html, selector);
	}
	return result;
}

function extractSimpleSelector(html: string, selector: string): string | undefined {
	const tag = selector.trim().replace(/^[#.]/u, "");
	if (!/^[A-Za-z][\w-]*$/u.test(tag)) return undefined;
	const regex = new RegExp(`<${escapeRegex(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeRegex(tag)}>`, "iu");
	const value = regex.exec(html)?.[1];
	return value ? cleanText(value.replaceAll(/<[^>]+>/gu, "")) : undefined;
}

function evaluateExpression(
	response: unknown,
	expression: string,
	values: Values,
	format: ResponseFormat,
): unknown {
	const alternatives = expression.split("||").map((part) => part.trim());
	if (alternatives.length > 1) {
		for (const alternative of alternatives) {
			const value = evaluateExpression(response, alternative, values, format);
			if (value !== undefined && value !== "") return value;
		}
		return undefined;
	}
	const [selector, ...transforms] = expression.split("|");
	let value: unknown;
	if (selector.startsWith("{{") && selector.endsWith("}}")) {
		value = expandTemplate(selector, values, new URL("https://example.invalid/"));
	} else if (format === "json" && selector.startsWith("$")) {
		value = extractJsonPath(response, selector);
	} else if (format === "xml" && selector.startsWith("xml:")) {
		value = extractXmlExpression(String(response), selector);
	} else {
		value = selector;
	}
	return applyValueTransforms(value, transforms, values);
}

/** Expand {{key}} and {{key|filter}} templates. */
function expandTemplate(template: string, values: Values, url: URL): string {
	return template.replaceAll(/\{\{\s*([^}]+)\s*\}\}/gu, (_match, rawKey: string) => {
		const [key, ...filters] = rawKey.split("|").map((part) => part.trim());
		let value = key === "url" ? url.toString() : (values[key] ?? "");
		for (const filter of filters) value = applyTemplateFilter(value, filter);
		return value;
	});
}

function applyTemplateFilter(value: string, filter: string): string {
	if (filter === "encodeURIComponent") return encodeURIComponent(value);
	if (filter === "encodePathSegments") return encodePathSegments(value);
	if (filter.startsWith("default:")) return value || filter.slice("default:".length);
	if (filter.startsWith("switch:")) return switchValue(value, filter.slice("switch:".length));
	return value;
}

function switchValue(value: string, spec: string): string {
	for (const option of spec.split(",")) {
		const index = option.indexOf("=");
		if (index <= 0) continue;
		const key = option.slice(0, index);
		const output = option.slice(index + 1);
		if (key === value || key === "*") return output.replaceAll("{value}", value);
	}
	return value;
}

function encodePathSegments(value: string): string {
	return value
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
}

/** Simple JSONPath-like extractor supporting $.a, $.a.b, $.a[0]. */
export function extractJsonPath(obj: unknown, path: string): unknown {
	if (path === "$" || path === "") return obj;
	if (!path.startsWith("$.")) return path;
	const segments = path.slice(2).split(".");
	let current: unknown = obj;
	for (const segment of segments) {
		if (current === null || current === undefined) return undefined;
		const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/u);
		if (arrayMatch) {
			const key = arrayMatch[1];
			const index = Number.parseInt(arrayMatch[2], 10);
			const arr = (current as Record<string, unknown>)[key];
			if (!Array.isArray(arr)) return undefined;
			current = arr[index];
		} else {
			current = (current as Record<string, unknown>)[segment];
		}
	}
	return current;
}

function applyValueTransforms(value: unknown, transforms: string[], values: Values): unknown {
	let current = value;
	for (const transform of transforms) {
		if (transform === "clean")
			current = Array.isArray(current)
				? current.map((item) => cleanValue(item))
				: cleanValue(current);
		else if (transform === "number") current = toNumber(current);
		else if (transform === "boolean") current = Boolean(current);
		else if (transform === "trueOnly") current = current === true ? true : undefined;
		else if (transform === "length")
			current = typeof current === "string" ? current.length : undefined;
		else if (transform === "firstLine") current = firstLine(current);
		else if (transform === "compact")
			current = Array.isArray(current)
				? current.filter((item) => item !== undefined && item !== null)
				: current;
		else if (transform === "emptyToUndefined") current = current === "" ? undefined : current;
		else if (transform.startsWith("truncate:"))
			current = truncateValue(current, transform.slice(9));
		else if (transform.startsWith("isLongerThan:"))
			current = isLongerThanValue(current, transform.slice(13));
		else if (transform.startsWith("unlessCapture:")) {
			current = values[transform.slice("unlessCapture:".length)] ? undefined : current;
		} else if (transform.startsWith("after:"))
			current = afterValue(current, transform.slice("after:".length));
		else if (transform.startsWith("pluck:")) current = pluckArray(current, transform.slice(6));
		else if (transform.startsWith("map:")) current = mapObjects(current, transform.slice(4));
	}
	return current;
}

function firstLine(value: unknown): unknown {
	if (typeof value !== "string") return undefined;
	return value
		.split("\n")
		.find((line) => line.trim())
		?.trim();
}

function truncateValue(value: unknown, rawMaxChars: string): unknown {
	if (typeof value !== "string") return value;
	const maxChars = Number.parseInt(rawMaxChars, 10);
	return Number.isFinite(maxChars) && value.length > maxChars ? value.slice(0, maxChars) : value;
}

function isLongerThanValue(value: unknown, rawMaxChars: string): unknown {
	if (typeof value !== "string") return undefined;
	const maxChars = Number.parseInt(rawMaxChars, 10);
	return Number.isFinite(maxChars) ? value.length > maxChars : undefined;
}

function pluckArray(value: unknown, path: string): unknown[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const selector = path.startsWith("$") ? path : `$.${path}`;
	return value.map((item) => extractJsonPath(item, selector));
}

function mapObjects(value: unknown, spec: string): unknown[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const fields = spec.split(",").flatMap((part) => {
		const index = part.indexOf("=");
		if (index <= 0) return [];
		return [[part.slice(0, index).trim(), part.slice(index + 1).trim()] as const];
	});
	return value.map((item) => {
		const output: Record<string, unknown> = {};
		for (const field of fields) {
			const [key, path] = field;
			const fieldValue = extractJsonPath(item, path.startsWith("$") ? path : `$.${path}`);
			if (fieldValue !== undefined) output[key] = fieldValue;
		}
		return output;
	});
}

function cleanValue(value: unknown): unknown {
	return typeof value === "string" ? cleanText(decodeXml(value)) || undefined : value;
}

function afterValue(value: unknown, marker: string): unknown {
	if (typeof value !== "string") return value;
	return value.split(marker).pop();
}

function toNumber(value: unknown): unknown {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function extractXmlExpression(xml: string, expression: string): unknown {
	const body = expression.slice("xml:".length);
	const [mode, rawPath] = splitOnce(body, ":");
	if (rawPath === undefined) return undefined;
	if (mode === "first") return firstXmlPath(xml, rawPath);
	if (mode === "all") return allXmlPath(xml, rawPath);
	if (mode === "attrs") return allXmlAttrs(xml, rawPath);
	if (mode === "attr") return firstXmlAttr(xml, rawPath);
	return undefined;
}

function firstXmlPath(xml: string, path: string): string | undefined {
	return allXmlPath(xml, path)[0];
}

function allXmlPath(xml: string, path: string): string[] {
	const parts = path.split(">").filter(Boolean);
	let chunks = [xml];
	for (const part of parts) chunks = chunks.flatMap((chunk) => allTags(chunk, part));
	return chunks;
}

function allXmlAttrs(xml: string, spec: string): string[] {
	const [path, attr = ""] = splitOnce(spec, "@");
	const parts = path.split(">").filter(Boolean);
	const tag = parts.pop();
	if (!tag) return [];
	const parents = parts.length > 0 ? allXmlPath(xml, parts.join(">")) : [xml];
	return parents.flatMap((parent) => tagAttrs(parent, tag, attr));
}

function firstXmlAttr(xml: string, spec: string): string | undefined {
	const [path, attr = ""] = splitOnce(spec, "@");
	const [tagPath, predicate] = splitOnce(path, "[");
	const attrs = allXmlAttrs(xml, `${tagPath}@${attr}`);
	if (!predicate) return attrs[0];
	const [predAttr, predValue = ""] = splitOnce(predicate.replace(/\]$/u, ""), "=");
	const [parentPath, tag = ""] = splitLast(tagPath, ">");
	const parents = parentPath ? allXmlPath(xml, parentPath) : [xml];
	return parents.flatMap((parent) => tagAttrsWhere(parent, tag, attr, predAttr, predValue))[0];
}

function allTags(xml: string, name: string): string[] {
	const regex = new RegExp(
		`<${escapeRegex(name)}\\b[^>]*>([\\s\\S]*?)</${escapeRegex(name)}>`,
		"giu",
	);
	return [...xml.matchAll(regex)].map((match) => match[1] || "");
}

function tagAttrs(xml: string, name: string, attr: string): string[] {
	const regex = new RegExp(`<${escapeRegex(name)}\\b([^>]*)>`, "giu");
	return [...xml.matchAll(regex)].flatMap((match) => attrValue(match[1] || "", attr) ?? []);
}

function tagAttrsWhere(
	xml: string,
	tag: string,
	attr: string,
	predicateAttr: string,
	predicateValue: string,
): string[] {
	const regex = new RegExp(`<${escapeRegex(tag)}\\b([^>]*)>`, "giu");
	return [...xml.matchAll(regex)].flatMap((match) => {
		const attrs = match[1] || "";
		return attrValue(attrs, predicateAttr) === predicateValue ? (attrValue(attrs, attr) ?? []) : [];
	});
}

function attrValue(attrs: string, attr: string): string | undefined {
	const regex = new RegExp(`${escapeRegex(attr)}="([^"]*)"`, "iu");
	return regex.exec(attrs)?.[1];
}

function splitOnce(value: string, separator: string): [string, string?] {
	const index = value.indexOf(separator);
	return index < 0 ? [value] : [value.slice(0, index), value.slice(index + separator.length)];
}

function splitLast(value: string, separator: string): [string, string?] {
	const index = value.lastIndexOf(separator);
	return index < 0 ? ["", value] : [value.slice(0, index), value.slice(index + separator.length)];
}

function escapeRegex(value: string): string {
	return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function decodeXml(value: string): string {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

async function runSelectorManifest(
	manifest: VerticalManifest,
	url: URL,
	match: Values,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const request = manifest.request!;
	const values = applyMatchOptions(url, match, manifest.matchOptions) ?? match;
	const page = await context.fetchPage?.(buildRequestUrl(request, url, values), signal);
	if (!page) throw new Error("fetchPage not available for selector manifest");
	return applyResultLimits(buildSelectorResult(manifest.extract ?? {}, page.text), manifest);
}

async function runPatternManifest(
	manifest: VerticalManifest,
	url: URL,
	match: Values,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const request = manifest.request!;
	const values = applyMatchOptions(url, match, manifest.matchOptions) ?? match;
	const text = await context.fetchText?.(buildRequestUrl(request, url, values), signal);
	if (text === undefined) throw new Error("fetchText not available for pattern manifest");
	const result: Record<string, unknown> = {};
	for (const [field, pattern] of Object.entries(manifest.extract ?? {})) {
		const regex = new RegExp(pattern, "gmu");
		const matches = Array.from(text.matchAll(regex)).map((m) => (m.length > 1 ? m[1] : m[0]));
		result[field] = matches.length > 1 ? matches : matches[0];
	}
	return result;
}
