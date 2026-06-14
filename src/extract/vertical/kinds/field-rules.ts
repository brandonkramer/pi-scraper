/** @file Generic YAML extraction-rule primitives for text, HTML, and JSON recipes. */
import { selectAll, selectOne } from "css-select";
import { type AnyNode, type Element, isTag } from "domhandler";
import { getAttributeValue, textContent } from "domutils";
import { parseDocument } from "htmlparser2";

import {
	extractHeadingSections,
	firstTextBySelector,
	sectionFromHeading,
} from "../../doc-structure.ts";
import { cleanText, stripUndefined, titleCase, truncateText } from "../../text.ts";
import type { VerticalExtractorContext } from "../capabilities.ts";
import { evaluateJsonWalkRule } from "../json-walk.ts";
import type { ManifestRequest, VerticalManifest } from "../manifest-types.ts";

type Scope = Record<string, unknown>;
type FieldSpec = Record<string, unknown>;

interface RuleExtractConfig {
	request?: ManifestRequest;
	clean?: Record<string, unknown>;
	fields: Record<string, unknown>;
}

function ruleExtractConfig(manifest: VerticalManifest): RuleExtractConfig {
	if (manifest.kind === "html-extract" || manifest.kind === "text-extract") {
		return {
			request: manifest.request,
			clean: record(manifest.clean),
			fields: record(manifest.fields) ?? {},
		};
	}
	return {
		request: manifest.recipe?.request,
		clean: record(manifest.recipe?.clean),
		fields: record(manifest.recipe?.fields) ?? {},
	};
}

export function supportsFieldRules(manifest: VerticalManifest): boolean {
	if (manifest.kind === "html-extract" || manifest.kind === "text-extract") return true;
	const primitive = manifest.recipe?.primitive;
	return (
		primitive === "text.extract" || primitive === "html.extract" || primitive === "json.extract"
	);
}

export async function runFieldRules(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	if (manifest.kind === "text-extract" || manifest.recipe?.primitive === "text.extract") {
		return await runTextRecipe(manifest, url, match, context, signal);
	}
	if (manifest.kind === "html-extract" || manifest.recipe?.primitive === "html.extract") {
		return await runHtmlRecipe(manifest, url, match, context, signal);
	}
	if (manifest.recipe?.primitive === "json.extract") {
		return await runJsonRecipe(manifest, url, match, context, signal);
	}
	throw new Error(`Unsupported rule extract kind: ${manifest.kind}`);
}

async function runTextRecipe(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const config = ruleExtractConfig(manifest);
	const requestUrl = buildRequestUrl(config.request, url, match);
	const text = context.fetchText
		? await context.fetchText(requestUrl, signal)
		: (await context.fetchPage?.(requestUrl, signal))?.text;
	if (text === undefined) throw new Error("text.extract requires fetchText or fetchPage support");
	const prepared = prepareText(text, config.clean);
	return evaluateFields(config.fields, { text: prepared, url: requestUrl, match });
}

async function runHtmlRecipe(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const config = ruleExtractConfig(manifest);
	const requestUrl = buildRequestUrl(config.request, url, match);
	const page = context.fetchPage ? await context.fetchPage(requestUrl, signal) : undefined;
	const html = page?.text ?? (await context.fetchText?.(requestUrl, signal));
	if (html === undefined) throw new Error("html.extract requires fetchPage or fetchText support");
	const finalUrl = new URL(page?.finalUrl ?? requestUrl);
	const document = parseDocument(html, { lowerCaseAttributeNames: true, lowerCaseTags: true });
	return evaluateFields(config.fields, { document, text: html, url: finalUrl.toString(), match });
}

async function runJsonRecipe(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const config = ruleExtractConfig(manifest);
	const requestUrl = buildRequestUrl(config.request, url, match);
	const json = await context.fetchJson<unknown>(requestUrl, signal);
	return evaluateFields(config.fields, { json, url: requestUrl, match });
}

function evaluateFields(fields: Record<string, unknown>, scope: Scope): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [name, rawSpec] of Object.entries(fields)) {
		const value = evaluateField(rawSpec, scope);
		if (value !== undefined) output[name] = value;
	}
	return output;
}

function evaluateField(rawSpec: unknown, scope: Scope): unknown {
	if (typeof rawSpec === "string") return expandTemplate(rawSpec, scope);
	if (typeof rawSpec === "number" || typeof rawSpec === "boolean" || rawSpec === null)
		return rawSpec;
	if (Array.isArray(rawSpec)) return rawSpec.map((item) => evaluateField(item, scope));
	const spec = record(rawSpec);
	if (!spec) return undefined;
	if ("value" in spec) return literalValue(spec.value, scope);
	if ("object" in spec) return evaluateObject(spec.object, scope);
	if ("collect" in spec || "walkObjects" in spec) return evaluateJsonWalkRule(scope.json, spec);
	if ("path" in spec) return readPath(scope.json, stringValue(spec.path));
	if ("regex" in spec) return regexValue(stringValue(scope.text), spec);
	if ("tokens" in spec) return tokenValues(stringValue(scope.text), spec.tokens);
	if ("sectionList" in spec) return sectionList(stringValue(scope.text), spec.sectionList);
	if ("selectorText" in spec) return selectorText(nodeValue(scope.document), spec.selectorText);
	if ("meta" in spec) return metaValue(nodeValue(scope.document), spec.meta);
	if (spec.kind === "docsitePlatform")
		return docsitePlatform(urlValue(scope), nodeValue(scope.document));
	if (spec.kind === "docsiteVersion")
		return docsiteVersion(urlValue(scope), nodeValue(scope.document));
	if (spec.kind === "breadcrumbs")
		return breadcrumbs(nodeValue(scope.document), urlValue(scope), spec);
	if (spec.kind === "headingSections") return headingSections(nodeValue(scope.document), spec);
	if (spec.kind === "mdnSignature") return mdnSignature(nodeValue(scope.document), scope);
	return undefined;
}

function evaluateObject(rawObject: unknown, scope: Scope): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	const object = record(rawObject) ?? {};
	for (const [key, valueSpec] of Object.entries(object)) {
		const value = evaluateField(valueSpec, scope);
		if (value !== undefined) output[key] = value;
	}
	return output;
}

function literalValue(value: unknown, scope: Scope): unknown {
	return typeof value === "string" ? expandTemplate(value, scope) : value;
}

function prepareText(text: string, clean: FieldSpec | undefined): string {
	let value = text;
	if (clean?.stripTags === true) value = value.replaceAll(/<[^>]+>/gu, " ");
	if (clean?.collapseWhitespace === true) value = value.replaceAll(/\s+/gu, " ");
	return clean?.trim === false ? value : value.trim();
}

function regexValue(text: string, spec: FieldSpec): unknown {
	const regex = new RegExp(stringValue(spec.regex), stringValue(spec.flags) || "u");
	const match = regex.exec(text);
	if (!match) return undefined;
	const group = typeof spec.group === "number" ? spec.group : 1;
	return applyTransforms(match[group], spec.transforms);
}

function tokenValues(text: string, rawSpec: unknown): string[] {
	const spec = record(rawSpec) ?? {};
	const after = stringValue(spec.after);
	const start = after ? text.indexOf(after) : 0;
	if (start < 0) return [];
	const tail = text.slice(start + after.length).trim();
	const values: string[] = [];
	for (const token of tail.split(/\s+/u)) {
		const candidate = token.replaceAll(/^[([{]+|[),.;:]+$/gu, "");
		if (!candidate) continue;
		if (spec.while === "sourcePath" && !isSourcePathToken(candidate)) break;
		values.push(candidate);
	}
	return values;
}

function sectionList(text: string, rawSpec: unknown): string[] {
	const spec = record(rawSpec) ?? {};
	const segment = textSegment(text, spec);
	const phrases = stringArray(spec.knownPhrases);
	const rejectPrefixes = stringArray(spec.rejectPrefixes);
	const minLength = typeof spec.minLength === "number" ? spec.minLength : 1;
	return dedupeSections(splitSectionSegment(segment, phrases), rejectPrefixes, minLength);
}

function textSegment(text: string, spec: FieldSpec): string {
	let start = 0;
	if (typeof spec.afterRegex === "string") {
		const match = new RegExp(spec.afterRegex, "iu").exec(text);
		start = match?.index === undefined ? 0 : match.index + match[0].length;
	} else if (typeof spec.after === "string") {
		const index = text.indexOf(spec.after);
		start = index < 0 ? 0 : index + spec.after.length;
	}
	const before = stringValue(spec.before);
	const end = before ? text.indexOf(before, start) : -1;
	return end < 0 ? text.slice(start) : text.slice(start, end);
}

function splitSectionSegment(segment: string, knownPhrases: string[]): string[] {
	const words = segment
		.replaceAll(/(?<=[a-z)])(?=[A-Z])/gu, " ")
		.split(/\s+/u)
		.map((word) => word.replaceAll(/^[^A-Za-z0-9]+|[^A-Za-z0-9&/._-]+$/gu, ""))
		.filter(Boolean);
	const sections: string[] = [];
	let index = 0;
	while (index < words.length) {
		const known = matchKnownPhrase(words, index, knownPhrases);
		if (known) {
			sections.push(known.label);
			index += known.words;
			continue;
		}
		sections.push(words[index] ?? "");
		index += 1;
	}
	return sections;
}

function selectorText(document: AnyNode, rawSelectors: unknown): string | undefined {
	const selectors = stringArray(rawSelectors);
	return firstTextBySelector(document, selectors);
}

function metaValue(document: AnyNode, rawNames: unknown): string | undefined {
	for (const name of stringArray(rawNames)) {
		const node = selectOne(`meta[name="${name}"],meta[property="${name}"]`, document);
		const content = node && isTag(node) ? getAttributeValue(node, "content") : undefined;
		if (content) return content;
	}
}

function docsitePlatform(url: URL, document: AnyNode): string {
	const host = url.hostname.toLowerCase();
	if (host === "developer.mozilla.org") return "mdn";
	if (host.endsWith(".readthedocs.io") || host === "readthedocs.io") return "readthedocs";
	if (host.endsWith(".gitbook.io") || host.endsWith(".gitbook.com") || host === "gitbook.com") {
		return "gitbook";
	}
	if (
		selectOne(
			'html[data-theme], .theme-doc-markdown, .navbar-sidebar, script[src*="docusaurus"]',
			document,
		)
	)
		return "docusaurus";
	if (selectOne(".wy-nav-side, .rst-content", document)) return "readthedocs";
	if (selectOne('[class*="gitbook"], [data-testid="page.outline"]', document)) return "gitbook";
	const firstPart = url.pathname.split("/").find(Boolean);
	return firstPart === "docs" || firstPart === "api" ? "docusaurus" : "unknown";
}

function docsiteVersion(url: URL, document: AnyNode): string | undefined {
	const metaVersion = metaValue(document, ["version", "docsearch:version"]);
	if (metaVersion) return metaVersion;
	const platform = docsitePlatform(url, document);
	const parts = url.pathname.split("/").filter(Boolean);
	if (platform === "readthedocs")
		return parts[1] && /^[a-z]{2}$/iu.test(parts[0] ?? "") ? parts[1] : parts[0];
	if (platform === "docusaurus" && ["docs", "api"].includes(parts[0] ?? "")) {
		return looksLikeVersion(parts[1]) ? parts[1] : undefined;
	}
}

function breadcrumbs(document: AnyNode, url: URL, spec: FieldSpec): string[] {
	for (const selector of stringArray(spec.selectors)) {
		const values = [
			...new Set(
				selectAll(selector, document)
					.map((node) => cleanText(textContent(node)))
					.filter(Boolean),
			),
		];
		if (values.length > 0) return values;
	}
	return url.pathname
		.split("/")
		.filter(Boolean)
		.slice(0, -1)
		.map((segment) => titleCase(segment));
}

function headingSections(document: AnyNode, spec: FieldSpec): unknown[] {
	const root = firstNode(document, stringArray(spec.rootSelectors)) ?? document;
	const contentChars = typeof spec.contentChars === "number" ? spec.contentChars : undefined;
	return extractHeadingSections(root, { contentChars });
}

function mdnSignature(document: AnyNode, scope: Scope): unknown {
	if (docsitePlatform(urlValue(scope), document) !== "mdn") return undefined;
	const title = stringValue(selectorText(document, ["main h1", "article h1", "h1", "title"]));
	const signature = selectorText(document, ["pre.syntaxbox", "pre code", "pre"]) ?? "";
	if (!signature.includes("(") && !title.includes("()")) return undefined;
	const parameters: Array<{ name: string; description?: string }> = [];
	for (const node of selectAll("dt", document)) {
		const code = selectOne("code", node);
		const name = cleanText(textContent(code ?? node));
		const description = cleanText(textOf((node as { next?: AnyNode }).next));
		if (name) parameters.push(stripUndefined({ name, description }));
	}
	return stripUndefined({
		name: title.replace(/\s*\(.*$/u, "").trim(),
		signature: signature || title,
		parameters: parameters.length > 0 ? parameters : undefined,
		returns: extractReturns(document),
	});
}

function extractReturns(document: AnyNode): { description?: string } | undefined {
	const returnsHeading = selectAll("h2,h3", document)
		.filter((node): node is Element => isTag(node))
		.find((node) => /returns?|return value/iu.test(textContent(node)));
	if (!returnsHeading) return;
	const section = sectionFromHeading(returnsHeading);
	const description = section.content ? truncateText(cleanText(section.content), 500) : undefined;
	return description ? { description } : undefined;
}

function applyTransforms(value: string | undefined, rawTransforms: unknown): unknown {
	let output = value;
	for (const transform of stringArray(rawTransforms)) {
		if (transform === "trim") output = output?.trim();
		if (transform === "cleanSection") output = cleanSectionName(output ?? "");
	}
	if (!output) return undefined;
	return output;
}

function buildRequestUrl(request: ManifestRequest | undefined, url: URL, scope: Scope): string {
	if (!request) return url.toString();
	const requestUrl = new URL(
		expandTemplate(request.urlTemplate, { ...scope, url: url.toString() }),
	);
	for (const [name, template] of Object.entries(request.queryParams ?? {})) {
		requestUrl.searchParams.set(name, expandTemplate(template, scope));
	}
	return requestUrl.toString();
}

function expandTemplate(template: string, scope: Scope): string {
	return template.replaceAll(/\{\{\s*([^}]+)\s*\}\}/gu, (_match, rawKey: string) => {
		const [key = "", ...filters] = rawKey.split("|").map((part) => part.trim());
		let value = stringValue(key === "url" ? scope.url : readPath(scope.match ?? scope, key));
		for (const filter of filters)
			if (filter === "encodeURIComponent") value = encodeURIComponent(value);
		return value;
	});
}

function readPath(value: unknown, path: string): unknown {
	if (!path) return value;
	let current = value;
	for (const part of path.split(".").filter(Boolean)) {
		const input = record(current);
		if (!input) return undefined;
		current = input[part];
	}
	return current;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function stringValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return `${value}`;
	}
	if (typeof value === "symbol") return value.description ?? "";
	return "";
}

function nodeValue(value: unknown): AnyNode {
	if (value && typeof value === "object") return value as AnyNode;
	return parseDocument("");
}

function urlValue(scope: Scope): URL {
	return new URL(stringValue(scope.url) || "https://example.com/");
}

function firstNode(document: AnyNode, selectors: string[]): AnyNode | undefined {
	for (const selector of selectors) {
		const node = selectOne(selector, document);
		if (node) return node;
	}
}

function matchKnownPhrase(
	words: string[],
	start: number,
	knownPhrases: string[],
): { label: string; words: number } | undefined {
	for (const label of knownPhrases) {
		const labelWords = label.split(" ");
		const candidate = words.slice(start, start + labelWords.length);
		if (
			candidate.length === labelWords.length &&
			candidate.join(" ").toLowerCase() === label.toLowerCase()
		)
			return { label, words: labelWords.length };
	}
}

function dedupeSections(sections: string[], rejectPrefixes: string[], minLength: number): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const section of sections) {
		const cleaned = cleanSectionName(section);
		if (
			!cleaned ||
			cleaned.length < minLength ||
			rejectPrefixes.some((prefix) => cleaned.startsWith(prefix)) ||
			seen.has(cleaned)
		)
			continue;
		seen.add(cleaned);
		result.push(cleaned);
	}
	return result;
}

function cleanSectionName(section: string): string {
	return section
		.replace(/^[^A-Za-z0-9]+/u, "")
		.replace(/[^A-Za-z0-9&/._\s-]+$/u, "")
		.trim();
}

function isSourcePathToken(token: string): boolean {
	return token.includes("/") || /\.[A-Za-z0-9][A-Za-z0-9_-]*(?:$|[?#])/u.test(token);
}

function textOf(node: AnyNode | null | undefined): string {
	return node ? textContent(node) : "";
}

function looksLikeVersion(value?: string): boolean {
	return Boolean(value && /^(?:v?\d+(?:\.\d+){0,3}|latest|next|stable)$/iu.test(value));
}
