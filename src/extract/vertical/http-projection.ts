/** @file HTTP JSON projection and multi-request manifest runners. */
import type { VerticalExtractorContext } from "./capabilities.ts";
import type {
	ManifestRecipeProjection,
	ManifestRecipeRequest,
	ManifestRecipeStep,
	ManifestRequest,
	VerticalManifest,
} from "./manifest-types.ts";

type Scope = Record<string, unknown>;

type FindConfig = NonNullable<ManifestRecipeStep["find"]>;

export async function runLegacyHttpJson(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	if (manifest.recipe?.primitive === "http.jsonResource") {
		return await runJsonResource(manifest, url, match, context, signal);
	}
	if (manifest.recipe?.primitive === "http.jsonChain") {
		return await runJsonChain(manifest, url, match, context, signal);
	}
	if (
		manifest.recipe?.primitive === "http.jsonAggregate" ||
		manifest.recipe?.primitive === "http.jsonParallel"
	) {
		return await runJsonAggregate(manifest, url, match, context, signal);
	}
	throw new Error(
		`Unsupported HTTP JSON recipe primitive: ${manifest.recipe?.primitive ?? "<missing>"}`,
	);
}

function isHttpJsonPrimitive(name: string | undefined): boolean {
	return (
		name === "http.jsonResource" ||
		name === "http.jsonChain" ||
		name === "http.jsonAggregate" ||
		name === "http.jsonParallel"
	);
}

export function supportsLegacyHttpJson(manifest: VerticalManifest): boolean {
	return isHttpJsonPrimitive(manifest.recipe?.primitive);
}

async function runJsonResource(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const scope: Scope = { ...match };
	const request = manifest.recipe?.request ?? manifest.request;
	if (!request) throw new Error("http.jsonResource recipe requires a request");
	const response = await fetchJsonRequest(request, url, scope, context, signal);
	throwIfConfigured(manifest, response, scope, url);
	const projection = manifest.recipe?.result ?? manifest.recipe?.extract ?? manifest.extract;
	if (!projection) return response;
	return projectObject(projection, response, scope, url);
}

async function runJsonChain(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const scope: Scope = { ...match };
	const steps = manifestSteps(manifest);
	if (steps.length === 0) throw new Error("HTTP JSON chain requires steps");
	for (const step of steps) {
		const response = step.request
			? await fetchJsonRequest(step.request, url, scope, context, signal)
			: scope;
		let value = step.select ? evaluateSelector(response, scope, step.select) : response;
		if (step.find) value = findInArray(value, step.find, scope, url);
		if (step.as) scope[step.as] = value;
	}
	throwIfConfigured(manifest, scope, scope, url);
	const projection = manifestProjection(manifest);
	return projection ? projectObject(projection, scope, scope, url) : scope;
}

export async function runApiJsonChain(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	return await runJsonChain(manifest, url, match, context, signal);
}

async function runJsonAggregate(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const scope: Scope = { ...match };
	const requests = manifest.requests ?? manifest.recipe?.requests ?? {};
	const entries = Object.entries(requests);
	if (entries.length === 0) throw new Error("HTTP JSON aggregate requires requests");
	const results = await Promise.all(
		entries.map(
			async ([name, request]) =>
				[name, await fetchAggregateRequest(request, url, scope, context, signal)] as const,
		),
	);
	for (const [name, value] of results) scope[name] = value;
	throwIfConfigured(manifest, scope, scope, url);
	const projection = manifestProjection(manifest);
	return projection ? projectObject(projection, scope, scope, url) : scope;
}

export async function runApiJsonAggregate(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	return await runJsonAggregate(manifest, url, match, context, signal);
}

function manifestSteps(manifest: VerticalManifest): ManifestRecipeStep[] {
	return (manifest.steps ?? manifest.recipe?.steps ?? []).filter((step) => isRecipeStep(step));
}

function isRecipeStep(
	value: ManifestRecipeStep | Record<string, unknown>,
): value is ManifestRecipeStep {
	return "request" in value || "select" in value || "as" in value || "find" in value;
}

function manifestProjection(
	manifest: VerticalManifest,
): Record<string, ManifestRecipeProjection> | undefined {
	const extract = manifest.extract;
	if (extract && typeof extract === "object") {
		return extract;
	}
	return manifest.recipe?.result;
}

async function fetchAggregateRequest(
	request: ManifestRecipeRequest,
	url: URL,
	scope: Scope,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	try {
		return await fetchJsonRequest(request, url, scope, context, signal);
	} catch (error) {
		if (!request.optional && request.fallback === undefined) throw error;
		return request.fallback === undefined
			? undefined
			: projectValue(request.fallback, {}, scope, url);
	}
}

function throwIfConfigured(
	manifest: VerticalManifest,
	response: unknown,
	scope: Scope,
	url: URL,
): void {
	const config = manifest.throwIf ?? manifest.recipe?.throwIf;
	if (!config) return;
	const value = evaluateSelector(response, scope, config.path);
	if (value === undefined || value === null || value === "") return;
	throw new Error(
		config.message ? expandTemplate(config.message, scope, url) : valueToString(value),
	);
}

async function fetchJsonRequest(
	request: ManifestRequest,
	url: URL,
	scope: Scope,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const finalUrl = buildRequestUrl(request, url, scope);
	const method = request.method ?? "GET";
	const hasCustomConfig =
		method !== "GET" || request.headers !== undefined || request.bodyTemplate !== undefined;
	if (hasCustomConfig && context.fetch) {
		const body = request.bodyTemplate
			? expandTemplate(request.bodyTemplate, scope, url)
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

function buildRequestUrl(request: ManifestRequest, url: URL, scope: Scope): string {
	const requestUrl = new URL(expandTemplate(request.urlTemplate, scope, url));
	for (const name of request.queryPassthrough ?? []) {
		const value = url.searchParams.get(name);
		if (value) requestUrl.searchParams.set(name, value);
	}
	for (const [name, template] of Object.entries(request.queryParams ?? {})) {
		requestUrl.searchParams.set(name, expandTemplate(template, scope, url));
	}
	return requestUrl.toString();
}

function projectObject(
	projection: Record<string, ManifestRecipeProjection>,
	response: unknown,
	scope: Scope,
	url: URL,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, spec] of Object.entries(projection)) {
		const value = projectValue(spec, response, scope, url);
		if (value !== undefined) result[key] = value;
	}
	return result;
}

function projectValue(
	spec: ManifestRecipeProjection,
	response: unknown,
	scope: Scope,
	url: URL,
): unknown {
	if (typeof spec === "string") return evaluateRecipeExpression(spec, response, scope, url);
	if (Array.isArray(spec)) return spec.map((item) => projectValue(item, response, scope, url));
	if (spec && typeof spec === "object") return projectObject(spec, response, scope, url);
	return spec;
}

function evaluateRecipeExpression(
	expression: string,
	response: unknown,
	scope: Scope,
	url: URL,
): unknown {
	for (const alternative of expression.split("||").map((part) => part.trim())) {
		let value: unknown;
		if (alternative.startsWith("{{") && alternative.endsWith("}}")) {
			value = expandTemplate(alternative, scope, url);
		} else {
			const [selector = "", ...transforms] = alternative.split("|").map((part) => part.trim());
			value = evaluateSelector(response, scope, selector);
			for (const transform of transforms) value = applyTransform(value, transform);
		}
		if (isPresent(value)) return value;
	}
}

function evaluateSelector(response: unknown, scope: Scope, selector: string): unknown {
	if (selector === "$") return response;
	if (selector === "@") return scope;
	if (selector.startsWith("$.")) return readPath(response, selector.slice(2));
	if (selector.startsWith("@.")) return readPath(scope, selector.slice(2));
	return selector;
}

function applyTransform(value: unknown, transform: string): unknown {
	if (transform === "number") return toNumber(value);
	if (transform === "boolean") return Boolean(value);
	if (transform === "trueOnly") return value === true ? true : undefined;
	if (transform === "length") return typeof value === "string" ? value.length : undefined;
	if (transform === "firstLine") return firstLine(value);
	if (transform === "base64") return decodeBase64(value);
	if (transform === "compact")
		return Array.isArray(value) ? value.filter((item) => isPresent(item)) : value;
	if (transform.startsWith("truncate:"))
		return truncate(value, transform.slice("truncate:".length));
	if (transform.startsWith("isLongerThan:")) {
		return isLongerThan(value, transform.slice("isLongerThan:".length));
	}
	if (transform.startsWith("filterDepth:")) {
		return filterDepth(value, transform.slice("filterDepth:".length));
	}
	if (transform.startsWith("filterType:")) {
		return filterType(value, transform.slice("filterType:".length).split(","));
	}
	if (transform.startsWith("pluck:")) return pluck(value, transform.slice("pluck:".length));
	if (transform.startsWith("pick:")) return pick(value, transform.slice("pick:".length).split(","));
	if (transform.startsWith("map:")) return mapObjects(value, transform.slice("map:".length));
	return value;
}

function firstLine(value: unknown): unknown {
	if (typeof value !== "string") return undefined;
	return value
		.split("\n")
		.find((line) => line.trim())
		?.trim();
}

function decodeBase64(value: unknown): unknown {
	return typeof value === "string" ? atob(value) : undefined;
}

function truncate(value: unknown, rawMaxChars: string): unknown {
	if (typeof value !== "string") return value;
	const maxChars = Number.parseInt(rawMaxChars, 10);
	return Number.isFinite(maxChars) && value.length > maxChars ? value.slice(0, maxChars) : value;
}

function isLongerThan(value: unknown, rawMaxChars: string): boolean | undefined {
	if (typeof value !== "string") return undefined;
	const maxChars = Number.parseInt(rawMaxChars, 10);
	return Number.isFinite(maxChars) ? value.length > maxChars : undefined;
}

function filterDepth(value: unknown, rawMaxDepth: string): unknown {
	if (!Array.isArray(value)) return undefined;
	const maxDepth = Number.parseInt(rawMaxDepth, 10);
	if (!Number.isFinite(maxDepth)) return value;
	return value.filter((item) => {
		const path = readPath(item, "path");
		return typeof path === "string" && path.split("/").length <= maxDepth;
	});
}

function filterType(value: unknown, allowed: string[]): unknown {
	if (!Array.isArray(value)) return undefined;
	const set = new Set(allowed.map((item) => item.trim()).filter(Boolean));
	return value.filter((item) => {
		const type = readPath(item, "type");
		return typeof type === "string" && set.has(type);
	});
}

function findInArray(value: unknown, config: FindConfig, scope: Scope, url: URL): unknown {
	if (!Array.isArray(value)) return undefined;
	const expected = expandTemplate(config.equals, scope, url);
	const match = value.find((item) => candidateValues(item, config).includes(expected));
	if (!match) {
		const message = config.errorMessage
			? expandTemplate(config.errorMessage, scope, url)
			: `No matching item found for ${expected}`;
		throw new Error(message);
	}
	return match;
}

function candidateValues(item: unknown, config: FindConfig): string[] {
	const values = [valueToString(evaluateSelector(item, {}, config.where))];
	if (config.include) values.push(valueToString(evaluateSelector(item, {}, config.include)));
	const filtered = values.filter(Boolean);
	return config.transform === "slugVariants"
		? filtered.flatMap((value) => slugVariants(value))
		: filtered;
}

function pluck(value: unknown, path: string): unknown[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.map((item) => readPath(item, path));
}

function pick(value: unknown, keys: string[]): unknown {
	if (Array.isArray(value)) return value.map((item) => pickObject(item, keys));
	return pickObject(value, keys);
}

function pickObject(value: unknown, keys: string[]): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") return undefined;
	const input = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const trimmed = key.trim();
		if (trimmed && input[trimmed] !== undefined) result[trimmed] = input[trimmed];
	}
	return result;
}

function mapObjects(value: unknown, spec: string): unknown[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const fields = spec.split(",").map((part) => splitOnce(part.trim(), "="));
	return value.map((item) => {
		const output: Record<string, unknown> = {};
		for (const [key, path] of fields) {
			if (!key || !path) continue;
			const fieldValue = readPath(item, path);
			if (fieldValue !== undefined) output[key] = fieldValue;
		}
		return output;
	});
}

function expandTemplate(template: string, scope: Scope, url: URL): string {
	return template.replaceAll(/\{\{\s*([^}]+)\s*\}\}/gu, (_match, rawKey: string) => {
		const [key = "", ...filters] = rawKey.split("|").map((part) => part.trim());
		let value = key === "url" ? url.toString() : valueToString(readPath(scope, key));
		for (const filter of filters) value = applyTemplateFilter(value, filter);
		return value;
	});
}

function applyTemplateFilter(value: string, filter: string): string {
	if (filter === "encodeURIComponent") return encodeURIComponent(value);
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

function readPath(value: unknown, path: string): unknown {
	if (path === "" || path === "$" || path === "@") return value;
	const parts = path
		.replace(/^[$@]\.?/u, "")
		.split(".")
		.filter(Boolean);
	let current = value;
	for (const part of parts) {
		if (current === null || current === undefined) return undefined;
		const arrayMatch = /^(.+)\[(\d+)\]$/u.exec(part);
		if (arrayMatch) {
			const key = arrayMatch[1];
			const index = Number.parseInt(arrayMatch[2], 10);
			const array = (current as Record<string, unknown>)[key];
			current = Array.isArray(array) ? array[index] : undefined;
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}
	return current;
}

function slugVariants(value: string): string[] {
	const lower = value.toLowerCase().trim();
	return [
		value,
		lower,
		lower
			.replaceAll("&", "")
			.replaceAll(/[^a-z0-9]/gu, "-")
			.replaceAll(/^-+|-+$/gu, ""),
		lower.replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-+|-+$/gu, ""),
	].filter(Boolean);
}

function toNumber(value: unknown): unknown {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function valueToString(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	return JSON.stringify(value);
}

function isPresent<T>(value: T | undefined | null | ""): value is T {
	return value !== undefined && value !== null && value !== "";
}

function splitOnce(value: string, separator: string): [string, string?] {
	const index = value.indexOf(separator);
	return index < 0 ? [value] : [value.slice(0, index), value.slice(index + separator.length)];
}
