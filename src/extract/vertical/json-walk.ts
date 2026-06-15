/** @file Declarative recursive JSON traversal and projection helpers. */
import { absoluteUrl, builtinTransforms } from "./transforms.ts";

export interface JsonWalkRuleSet {
	comments?: unknown;
	commentCount?: unknown;
	continuationToken?: unknown;
}

type JsonRecord = Record<string, unknown>;
export function evaluateJsonWalkRule(value: unknown, rawSpec: unknown): unknown {
	const spec = record(rawSpec);
	if (!spec) return undefined;
	if (Array.isArray(spec.collect)) return collectValues(value, spec);
	if (spec.walkObjects) return walkObjectsValue(value, spec.walkObjects);
	if (spec.path) return readPath(value, stringValue(spec.path));
	return undefined;
}

function collectValues(value: unknown, spec: JsonRecord): JsonRecord[] {
	const collectors = spec.collect;
	if (!Array.isArray(collectors)) return [];
	const output: JsonRecord[] = [];
	for (const rawCollector of collectors) {
		const collector = record(rawCollector);
		const walkSpec = record(collector?.walkObjects);
		if (!walkSpec) continue;
		walkObjects(value, (object) => {
			if (!matchesWhen(object, record(walkSpec.when))) return;
			const projected = projectObject(object, record(walkSpec.emit));
			if (Object.keys(projected).length > 0) output.push(projected);
		});
	}
	const deduped = dedupeBy(output, stringArray(spec.dedupeBy));
	return deduped.slice(0, limitValue(spec.maxItems, deduped.length));
}

function walkObjectsValue(value: unknown, rawSpec: unknown): unknown {
	const spec = record(rawSpec);
	if (!spec) return undefined;
	const first = record(spec.first);
	if (first) return firstWalkValue(value, first);
	return undefined;
}

function firstWalkValue(value: unknown, spec: JsonRecord): unknown {
	let fallback: unknown;
	let found: unknown;
	walkObjects(value, (object) => {
		if (found !== undefined) return;
		if (!matchesWhen(object, record(spec.when))) return;
		const candidate = evaluateValueSpec(object, spec);
		if (candidate === undefined || candidate === "") return;
		fallback ??= candidate;
		const preferred = stringValue(spec.preferIncludes);
		if (!preferred || stringValue(candidate).includes(preferred)) found = candidate;
	});
	return found ?? fallback;
}

function projectObject(object: JsonRecord, emit: JsonRecord | undefined): JsonRecord {
	const output: JsonRecord = {};
	if (!emit) return output;
	for (const [key, valueSpec] of Object.entries(emit)) {
		const value = evaluateValueSpec(object, valueSpec);
		if (value !== undefined && value !== "") output[key] = value;
	}
	return output;
}

function evaluateValueSpec(object: unknown, rawSpec: unknown): unknown {
	if (typeof rawSpec === "string") return readPath(object, rawSpec);
	const spec = record(rawSpec);
	if (!spec) return undefined;
	if (typeof spec.exists === "string") return readPath(object, spec.exists) !== undefined;
	let value = spec.path === undefined ? object : readPath(object, stringValue(spec.path));
	if (spec.transform !== undefined) value = applyTransforms(value, spec.transform);
	return value;
}

function matchesWhen(object: JsonRecord, when: JsonRecord | undefined): boolean {
	if (!when) return true;
	const required = stringArray(when.has);
	return required.every((path) => readPath(object, path) !== undefined);
}

function applyTransforms(value: unknown, rawTransform: unknown): unknown {
	let output = value;
	const transforms = Array.isArray(rawTransform) ? rawTransform : [rawTransform];
	for (const transform of transforms) {
		if (typeof transform === "string") {
			output = applyNamedTransform(output, transform);
			continue;
		}
		const firstStringKeys = stringArray(transform.firstStringByKey);
		if (firstStringKeys.length > 0) output = firstStringByKey(output, firstStringKeys);
	}
	return output;
}

function applyNamedTransform(value: unknown, transform: string): unknown {
	if (transform === "number") return toNumber(value);
	if (transform === "trueOnly") return value === true ? true : undefined;
	if (transform === "trim") return typeof value === "string" ? value.trim() : value;
	if (transform === "string") return stringValue(value);
	if (transform.startsWith("absoluteUrl:"))
		return absoluteUrl(value, transform.slice("absoluteUrl:".length));
	const builtin = builtinTransforms.get(transform);
	if (builtin) return builtin(value, {});
	return value;
}

function toNumber(value: unknown): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function firstStringByKey(value: unknown, keys: string[]): string | undefined {
	let found: string | undefined;
	walkObjects(value, (object) => {
		if (found) return;
		for (const key of keys) {
			const valueAtKey = object[key];
			if (typeof valueAtKey === "string") {
				found = valueAtKey;
				return;
			}
		}
	});
	return found;
}

function walkObjects(value: unknown, visit: (object: JsonRecord) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) walkObjects(item, visit);
		return;
	}
	const object = record(value);
	if (!object) return;
	visit(object);
	for (const child of Object.values(object)) walkObjects(child, visit);
}

function dedupeBy(items: JsonRecord[], keys: string[]): JsonRecord[] {
	if (keys.length === 0) return items;
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = keys.map((name) => stringValue(item[name])).join("\n");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
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

function record(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}

function stringArray(value: unknown): string[] {
	if (typeof value === "string") return [value];
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function limitValue(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.trunc(value))
		: fallback;
}

function stringValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return `${value}`;
	}
	return "";
}
