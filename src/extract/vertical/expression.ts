/** @file Shared manifest field expressions, requests, and XML helpers. */
import { cleanText } from "../text.ts";
import type { VerticalExtractorContext } from "./capabilities.ts";
import { extractJsonPath } from "./manifest-json-path.ts";
import type { ManifestRequest, VerticalManifest } from "./manifest-types.ts";

export type MatchValues = Record<string, string>;
export type ResponseFormat = "json" | "xml";
export async function fetchJsonRequest(
	request: ManifestRequest,
	url: URL,
	values: MatchValues,
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

export function buildRequestUrl(request: ManifestRequest, url: URL, values: MatchValues): string {
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

export function buildExtractResult(
	extract: Record<string, string>,
	response: unknown,
	values: MatchValues,
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

export function applyResultLimits(
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

function evaluateExpression(
	response: unknown,
	expression: string,
	values: MatchValues,
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
function expandTemplate(template: string, values: MatchValues, url: URL): string {
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

function applyValueTransforms(value: unknown, transforms: string[], values: MatchValues): unknown {
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
