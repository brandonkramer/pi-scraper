/** @file Bounded HTTP workflow recipe primitive. */
import { createStructuredError, hasStructuredError } from "../../../http/errors.ts";
import type { VerticalExtractorContext } from "../capabilities.ts";
import { evaluateJsonWalkRule } from "../json-walk-rules.ts";
import type { VerticalManifest } from "./types.ts";

type Scope = Record<string, unknown>;
type WorkflowObject = Record<string, unknown>;

export function supportsWorkflowRecipe(manifest: VerticalManifest): boolean {
	return manifest.kind === "http-workflow" || manifest.recipe?.primitive === "http.workflow";
}

export async function runHttpWorkflowManifest(
	manifest: VerticalManifest,
	url: URL,
	match: Record<string, string>,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<unknown> {
	return await runWorkflowRecipe(manifest, url, match, context, signal);
}

export async function runWorkflowRecipe(
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
	const attempts: string[] = [];
	const robotsDenied: string[] = [];
	for (const endpoint of endpoints) {
		const endpointConfig = stepConfig(endpoint);
		if (!endpointEnabled(endpointConfig, scope)) continue;
		const target = stepUrl(endpointConfig, url, scope);
		if (!target) continue;
		attempts.push(target);
		try {
			const page = context.fetchPage ? await context.fetchPage(target, signal) : undefined;
			if (!page) throw new Error("tryJson requires page fetch support");
			throwForStatus(page.status, page.text);
			const as = stringValue(step.as);
			const endpointAs = stringValue(step.endpointAs);
			const finalUrlAs = stringValue(step.finalUrlAs);
			if (as) scope[as] = JSON.parse(page.text) as unknown;
			if (endpointAs) scope[endpointAs] = target;
			if (finalUrlAs) scope[finalUrlAs] = page.finalUrl;
			return;
		} catch (error) {
			if (hasStructuredError(error) && error.structured.code === "ROBOTS_DENIED") {
				robotsDenied.push(target);
				continue;
			}
			throw normalizeWorkflowError(error);
		}
	}
	if (step.fallback === "redditBlockedMetadata") {
		scope[stringValue(step.as) || "response"] = redditBlockedMetadata(
			scope,
			robotsDenied.length > 0 ? robotsDenied : attempts,
		);
		return;
	}
	if (step.fallback === "redditListingBlockedMetadata") {
		scope[stringValue(step.as) || "response"] = redditListingBlockedMetadata(
			scope,
			robotsDenied.length > 0 ? robotsDenied : attempts,
		);
		return;
	}
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
	if (expression.startsWith("{{") && expression.endsWith("}}"))
		return expandTemplate(expression, scope, url);
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
	if (transform === "redditUrl") return redditUrl(value);
	if (transform === "compact")
		return Array.isArray(value) ? value.filter((item) => isPresent(item)) : value;
	if (transform === "youtubeCaptionTrack")
		return youtubeCaptionTrack(value, stringValue(scope.language));
	if (transform === "youtubeTranscript")
		return youtubeTranscript(value, readPath(scope, stringValue(options.trackFrom)));
	if (transform.startsWith("map:")) return mapObjects(value, transform.slice(4));
	return value;
}

function redditUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || !value) return undefined;
	return value.startsWith("/") ? `https://www.reddit.com${value}` : value;
}

function youtubeCaptionTrack(value: unknown, language: string): unknown {
	if (!Array.isArray(value)) return undefined;
	return (
		value.find(
			(track) =>
				trackField(track, "languageCode") === language && trackField(track, "kind") !== "asr",
		) ??
		value.find((track) => trackField(track, "languageCode") === language) ??
		value.find((track) => trackField(track, "kind") !== "asr") ??
		value[0]
	);
}

function youtubeTranscript(raw: unknown, track: unknown): unknown {
	if (typeof raw !== "string" || !record(track)) return undefined;
	const segments = [...raw.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu)]
		.map((match) => ({
			text: decodeEntities(stripTags(match[2])).trim(),
			start: Number.parseFloat(attr(match[1], "start") ?? "0"),
			duration: Number.parseFloat(attr(match[1], "dur") ?? "0"),
		}))
		.filter((segment) => segment.text);
	if (segments.length === 0) return undefined;
	return {
		languageCode: trackField(track, "languageCode"),
		languageName: captionName(track),
		isGenerated: trackField(track, "kind") === "asr",
		segments,
		text: segments.map((segment) => segment.text).join("\n"),
	};
}

function endpointEnabled(endpoint: WorkflowObject, scope: Scope): boolean {
	const when = stringValue(endpoint.when);
	if (when && !isPresent(readPath(scope, when))) return false;
	const unless = stringValue(endpoint.unless);
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

function throwForStatus(status: number, text: string): void {
	if (status === 403) throw workflowError("REDDIT_BLOCKED", "Reddit returned 403/blocked.", false);
	if (status === 429)
		throw workflowError("REDDIT_RATE_LIMITED", "Reddit rate limit exceeded.", true);
	if (status >= 400) throw new Error(`HTTP ${status}: ${text.slice(0, 120)}`);
}

function redditBlockedMetadata(scope: Scope, attemptedEndpoints: string[]): unknown {
	const subreddit = valueToString(scope.subreddit) || undefined;
	const postId = valueToString(scope.postId);
	return {
		id: postId,
		subreddit,
		permalink: subreddit
			? `https://www.reddit.com/r/${subreddit}/comments/${postId}/`
			: `https://www.reddit.com/comments/${postId}/`,
		source: {
			provider: "reddit",
			endpoint: attemptedEndpoints[0] ?? "",
			blocked: true,
			attemptedEndpoints,
		},
	};
}

function redditListingBlockedMetadata(scope: Scope, attemptedEndpoints: string[]): unknown {
	return {
		subreddit: valueToString(scope.subreddit),
		sort: valueToString(scope.sort) || "hot",
		posts: [],
		source: {
			provider: "reddit",
			endpoint: attemptedEndpoints[0] ?? "",
			blocked: true,
			attemptedEndpoints,
		},
	};
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

function captionName(track: unknown): string | undefined {
	const name = readPath(track, "name.simpleText");
	if (typeof name === "string") return name;
	const runs = readPath(track, "name.runs");
	return Array.isArray(runs)
		? runs.map((run) => valueToString(readPath(run, "text"))).join("")
		: undefined;
}

function trackField(track: unknown, field: string): string | undefined {
	const value = readPath(track, field);
	return typeof value === "string" ? value : undefined;
}

function attr(attrs: string | undefined, name: string): string | undefined {
	return new RegExp(`${name}="([^"]*)"`, "u").exec(attrs ?? "")?.[1];
}

function decodeEntities(value: string): string {
	return value.replaceAll(
		/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/giu,
		(match, dec: string, hex: string, named: string) => {
			if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
			if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
			return (
				({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[named] ??
				match
			);
		},
	);
}

function stripTags(value: string): string {
	return value.replaceAll(/<[^>]+>/gu, "");
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
