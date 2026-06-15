/** @file Http-workflow manifest runner. */
import { createStructuredError, hasStructuredError } from "../../../http/errors.ts";
import { extractReadable } from "../../../parse/page/readable.ts";
import type { VerticalExtractorContext } from "../capabilities.ts";
import { evaluateJsonWalkRule } from "../json-walk.ts";
import type { VerticalManifest } from "../manifest-types.ts";
import { absoluteUrl, builtinTransforms } from "../transforms.ts";

type Scope = Record<string, unknown>;
type WorkflowObject = Record<string, unknown>;

export function supportsHttpWorkflow(manifest: VerticalManifest): boolean {
	return manifest.kind === "http-workflow" || manifest.recipe?.primitive === "http.workflow";
}

export async function runHttpWorkflow(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	const scope: Scope = { ...match, url: url.toString() };
	const steps = workflowSteps(manifest);
	for (const step of steps) {
		const object = record(step);
		if (object?.fetchText) await fetchTextStep(object.fetchText, url, scope, context, signal);
		else if (object?.readable) readableStep(object.readable, url, scope);
		else if (object?.regex) regexStep(object.regex, scope);
		else if (object?.postJson) await postJsonStep(object.postJson, url, scope, context, signal);
		else if (object?.select) selectStep(object.select, scope);
		else if (object?.jsonWalk) jsonWalkStep(object.jsonWalk, scope);
		else if (object?.transform) transformStep(object.transform, scope);
		else if (object?.tryJson) await tryJsonStep(object.tryJson, url, scope, context, signal);
		else if (object?.extract) return project(record(object.extract) ?? {}, scope, url);
	}
	const projection = manifestProjection(manifest);
	return projection ? project(projection, scope, url) : scope;
}

function workflowSteps(manifest: VerticalManifest): Array<Record<string, unknown>> {
	const steps = manifest.steps ?? manifest.recipe?.steps ?? [];
	if (!Array.isArray(steps)) return [];
	const result: Array<Record<string, unknown>> = [];
	for (const step of steps) {
		if (typeof step === "object") result.push(step as Record<string, unknown>);
	}
	return result;
}

function manifestProjection(manifest: VerticalManifest): Record<string, unknown> | undefined {
	if (manifest.extract && typeof manifest.extract === "object") {
		return manifest.extract as Record<string, unknown>;
	}
	return manifest.recipe?.result as Record<string, unknown> | undefined;
}

async function fetchTextStep(
	raw: unknown,
	url: URL,
	scope: Scope,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<void> {
	const step = stepConfig(raw);
	if (!stepEnabled(step, scope)) return;
	const target = stepUrl(step, url, scope);
	if (!target) {
		if (step.optional === true) return;
		throw new Error("fetchText step requires url or urlFrom");
	}
	const text =
		step.preferPage === true
			? ((await context.fetchPage?.(target, signal))?.text ??
				(await context.fetchText?.(target, signal)))
			: context.fetchText
				? await context.fetchText(target, signal)
				: (await context.fetchPage?.(target, signal))?.text;
	if (text === undefined && step.optional !== true)
		throw new Error("fetchText requires text support");
	const as = stringValue(step.as);
	if (as && text !== undefined) scope[as] = text;
}

function readableStep(raw: unknown, url: URL, scope: Scope): void {
	const step = stepConfig(raw);
	if (!stepEnabled(step, scope)) return;
	const text = stringValue(readPath(scope, stringValue(step.from)));
	const as = stringValue(step.as);
	if (!text || !as) {
		if (step.optional !== true) throw new Error("readable step requires from and as");
		return;
	}
	const sourceUrl = stringValue(readPath(scope, stringValue(step.urlFrom))) || url.toString();
	const value = extractReadable(text, sourceUrl);
	if (!value.ok && step.optional === true) return;
	scope[as] = value;
}

function regexStep(raw: unknown, scope: Scope): void {
	const step = stepConfig(raw);
	const input = stringValue(readPath(scope, stringValue(step.from)));
	const pattern = stringValue(step.pattern);
	const match = new RegExp(pattern, stringValue(step.flags) || "u").exec(input);
	const group = typeof step.group === "number" ? step.group : 1;
	const value = match?.[group] ?? step.default;
	const as = stringValue(step.as);
	if (as && value !== undefined) scope[as] = value;
	if (!match && step.required === true) throw new Error(`regex did not match: ${pattern}`);
}

async function postJsonStep(
	raw: unknown,
	url: URL,
	scope: Scope,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<void> {
	const step = stepConfig(raw);
	if (step.when && !isPresent(readPath(scope, stringValue(step.when)))) return;
	if (!context.fetchJsonPost) throw new Error("postJson requires POST JSON fetch support");
	const target = stepUrl(step, url, scope);
	if (!target) throw new Error("postJson step requires url or urlFrom");
	const value = await context.fetchJsonPost(
		target,
		expandValue(step.body ?? {}, scope, url),
		signal,
	);
	const as = stringValue(step.as);
	if (as) scope[as] = value;
}

function selectStep(raw: unknown, scope: Scope): void {
	const step = stepConfig(raw);
	let value = readPath(scope, stringValue(step.from));
	if (step.path) value = readPath(value, stringValue(step.path));
	if (typeof step.transform === "string")
		value = applyTransform(value, step.transform, step, scope);
	const as = stringValue(step.as);
	if (as) scope[as] = value;
}

function jsonWalkStep(raw: unknown, scope: Scope): void {
	const step = stepConfig(raw);
	const value = evaluateJsonWalkRule(readPath(scope, stringValue(step.from)), step.rule ?? step);
	const as = stringValue(step.as);
	if (as) scope[as] = value;
}

function transformStep(raw: unknown, scope: Scope): void {
	const step = stepConfig(raw);
	const value = applyTransform(
		readPath(scope, stringValue(step.from)),
		stringValue(step.transform),
		step,
		scope,
	);
	const as = stringValue(step.as);
	if (as) scope[as] = value;
}

async function tryJsonStep(
	raw: unknown,
	url: URL,
	scope: Scope,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<void> {
	const step = stepConfig(raw);
	const endpoints = Array.isArray(step.endpoints) ? step.endpoints : [];
	const fallback = record(step.fallback);
	const attempts: string[] = [];
	for (const endpoint of endpoints) {
		const endpointConfig = stepConfig(endpoint);
		if (!endpointEnabled(endpointConfig, scope)) continue;
		const target = stepUrl(endpointConfig, url, scope);
		if (!target) continue;
		attempts.push(target);
		try {
			const page = context.fetchPage ? await context.fetchPage(target, signal) : undefined;
			if (!page) throw new Error("tryJson requires page fetch support");
			throwForStatus(page.status, page.text, step.onStatus);
			const as = stringValue(step.as);
			const endpointAs = stringValue(step.endpointAs);
			const finalUrlAs = stringValue(step.finalUrlAs);
			if (as) scope[as] = JSON.parse(page.text) as unknown;
			if (endpointAs) scope[endpointAs] = target;
			if (finalUrlAs) scope[finalUrlAs] = page.finalUrl;
			return;
		} catch (error) {
			if (hasStructuredError(error) && error.structured.code === "ROBOTS_DENIED") {
				continue;
			}
			if (shouldUseFallbackForEndpointError(error, fallback)) continue;
			if (step.continueOnError === true || step.optional === true) continue;
			throw normalizeWorkflowError(error);
		}
	}
	if (fallback) {
		const fallbackScope: Scope = {
			...scope,
			attemptedEndpoints: attempts,
		};
		scope[stringValue(step.as) || "response"] = project(fallback, fallbackScope, url);
		return;
	}
	if (step.optional === true) return;
	throw new Error(`No endpoint succeeded: ${attempts.join(", ")}`);
}

function project(spec: WorkflowObject, scope: Scope, url: URL): WorkflowObject {
	const output: WorkflowObject = {};
	for (const [key, valueSpec] of Object.entries(spec)) {
		const value = projectValue(valueSpec, scope, url);
		if (value !== undefined) output[key] = value;
	}
	return output;
}

function projectValue(spec: unknown, scope: Scope, url: URL): unknown {
	if (typeof spec === "string") return evaluateExpression(spec, scope, url);
	if (typeof spec === "number" || typeof spec === "boolean" || spec === null) return spec;
	if (Array.isArray(spec)) return spec.map((item) => projectValue(item, scope, url));
	const object = record(spec);
	if (!object) return undefined;
	if (object.jsonWalk) {
		const walk = record(object.jsonWalk) ?? {};
		const source = stringValue(walk.from ?? object.from);
		const { from: _from, ...rule } = walk;
		return evaluateJsonWalkRule(readPath(scope, source), rule);
	}
	if (object.object) return project(record(object.object) ?? {}, scope, url);
	if (object.value !== undefined) return projectValue(object.value, scope, url);
	if (object.path) return readPath(scope, stringValue(object.path));
	return project(object, scope, url);
}

function evaluateExpression(expression: string, scope: Scope, url: URL): unknown {
	for (const alternative of expression.split("||").map((part) => part.trim())) {
		const value = evaluateExpressionAlternative(alternative, scope, url);
		if (isPresent(value)) return value;
	}
}

function evaluateExpressionAlternative(expression: string, scope: Scope, url: URL): unknown {
	if (expression.includes("{{")) return expandTemplate(expression, scope, url);
	const [selector = "", ...transforms] = expression.split("|").map((part) => part.trim());
	let value = selector.startsWith("@.") ? readPath(scope, selector.slice(2)) : selector;
	for (const transform of transforms) value = applyTransform(value, transform, {}, scope);
	return value;
}

function applyTransform(
	value: unknown,
	transform: string,
	options: WorkflowObject,
	scope: Scope,
): unknown {
	if (transform === "number") return toNumber(value);
	if (transform === "trueOnly") return value === true ? true : undefined;
	if (transform === "compact")
		return Array.isArray(value) ? value.filter((item) => isPresent(item)) : value;
	if (transform.startsWith("absoluteUrl:"))
		return absoluteUrl(value, transform.slice("absoluteUrl:".length));
	if (transform.startsWith("map:")) return mapObjects(value, transform.slice(4));
	const builtin = builtinTransforms.get(transform);
	if (builtin)
		return builtin(value, {
			language: stringValue(scope.language),
			track: readPath(scope, stringValue(options.trackFrom)),
		});
	return value;
}

function endpointEnabled(endpoint: WorkflowObject, scope: Scope): boolean {
	return stepEnabled(endpoint, scope);
}

function stepEnabled(step: WorkflowObject, scope: Scope): boolean {
	const when = stringValue(step.when);
	if (when && !isPresent(readPath(scope, when))) return false;
	const unless = stringValue(step.unless);
	return !(unless && isPresent(readPath(scope, unless)));
}

function stepUrl(step: WorkflowObject, url: URL, scope: Scope): string | undefined {
	const raw = step.urlFrom ? readPath(scope, stringValue(step.urlFrom)) : step.url;
	if (typeof raw !== "string") return undefined;
	let output = expandTemplate(raw, scope, url);
	if (step.stripTranscriptFormat === true) output = output.replace("&fmt=srv3", "");
	return output || undefined;
}

function expandValue(value: unknown, scope: Scope, url: URL): unknown {
	if (typeof value === "string") return expandTemplate(value, scope, url);
	if (Array.isArray(value)) return value.map((item) => expandValue(item, scope, url));
	const object = record(value);
	if (!object) return value;
	return Object.fromEntries(
		Object.entries(object).map(([key, item]) => [key, expandValue(item, scope, url)]),
	);
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
		const [key, output] = splitOnce(option, "=");
		if (!key || output === undefined) continue;
		if (key === value || key === "*")
			return output.replaceAll("{value}", value).replaceAll("$value", value);
	}
	return value;
}

function throwForStatus(status: number, text: string, onStatus: unknown): void {
	const entry = record(record(onStatus)?.[String(status)]);
	if (entry)
		throw workflowError(
			stringValue(entry.code) || `HTTP_${status}`,
			stringValue(entry.message) || `HTTP ${status}`,
			entry.retryable === true,
		);
	if (status >= 400) throw new Error(`HTTP ${status}: ${text.slice(0, 120)}`);
}

function shouldUseFallbackForEndpointError(
	error: unknown,
	fallback: WorkflowObject | undefined,
): boolean {
	if (!fallback) return false;
	if (hasStructuredError(error) && error.structured.phase === "extract")
		return !error.structured.retryable;
	return error instanceof SyntaxError;
}

function normalizeWorkflowError(error: unknown): Error {
	if (hasStructuredError(error))
		return workflowError(
			error.structured.code,
			error.structured.message,
			error.structured.retryable,
		);
	return error instanceof Error ? error : new Error("Workflow extraction failed");
}

function workflowError(code: string, message: string, retryable: boolean): Error {
	return createStructuredError({ code, phase: "extract", message, retryable }, "WorkflowError");
}

function mapObjects(value: unknown, spec: string): unknown[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const fields = spec.split(",").map((part) => splitOnce(part.trim(), "="));
	return value.map((item) =>
		Object.fromEntries(
			fields.flatMap(([key, path]) => (key && path ? [[key, readPath(item, path)]] : [])),
		),
	);
}

function readPath(value: unknown, path: string): unknown {
	if (!path) return value;
	let current = value;
	for (const part of path.split(".").filter(Boolean)) {
		if (current === undefined || current === null) return undefined;
		const match = /^(.+)\[(\d+)\]$/u.exec(part);
		if (match) {
			const array = (current as Record<string, unknown>)[match[1]];
			current = Array.isArray(array) ? array[Number(match[2])] : undefined;
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}
	return current;
}

function toNumber(value: unknown): unknown {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function stepConfig(value: unknown): WorkflowObject {
	return record(value) ?? {};
}

function record(value: unknown): WorkflowObject | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as WorkflowObject)
		: undefined;
}

function valueToString(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
		return String(value);
	return "";
}

function stringValue(value: unknown): string {
	return valueToString(value);
}

function isPresent<T>(value: T | undefined | null | ""): value is T {
	return value !== undefined && value !== null && value !== "";
}

function splitOnce(value: string, separator: string): [string, string?] {
	const index = value.indexOf(separator);
	return index < 0 ? [value] : [value.slice(0, index), value.slice(index + separator.length)];
}
