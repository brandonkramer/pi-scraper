/**
 * @fileoverview parse data-islands module.
 */
import { normalizeWhitespace } from "../../serialize/text.ts";
import type { DomAdapter } from "../dom/adapter.ts";

export interface DataIslandContent {
	source: string;
	type: "json_ld" | "next_data" | "hydration" | "json_script";
	title?: string;
	text: string;
	data?: unknown;
}

const TEXT_KEYS = new Set([
	"title",
	"name",
	"headline",
	"description",
	"text",
	"articleBody",
	"content",
	"summary",
]);

export function recoverDataIslands(dom: DomAdapter): DataIslandContent[] {
	const results: DataIslandContent[] = [];
	for (const node of dom.nodes(dom.select("script"))) {
		const typeAttr = (dom.attr(node, "type") ?? "").toLowerCase();
		const id = dom.attr(node, "id") ?? "";
		const raw = dom.text(node).trim();
		if (!raw) continue;

		const type = islandType(typeAttr, id, raw);
		if (!type) continue;
		const parsed = parseJsonPayload(raw, type);
		if (parsed === undefined) continue;
		const strings = collectUsefulStrings(parsed);
		const text = normalizeWhitespace(strings.join("\n"));
		if (!text) continue;
		results.push({
			source: id || typeAttr || "script",
			type,
			title: firstTitle(parsed),
			text,
			data: parsed,
		});
	}
	return results;
}

function islandType(
	typeAttr: string,
	id: string,
	raw: string,
): DataIslandContent["type"] | undefined {
	if (typeAttr === "application/ld+json") return "json_ld";
	if (id === "__NEXT_DATA__") return "next_data";
	if (typeAttr === "application/json") return "json_script";
	if (/__NUXT__|__APOLLO_STATE__|window\.__INITIAL_STATE__/u.test(raw)) {
		return "hydration";
	}
	return undefined;
}

function parseJsonPayload(
	raw: string,
	type: DataIslandContent["type"],
): unknown {
	try {
		if (type !== "hydration") return JSON.parse(raw);
		const match = raw.match(
			/(?:__NUXT__|__APOLLO_STATE__|__INITIAL_STATE__)\s*=\s*(\{[\s\S]*\});?/u,
		);
		return match ? JSON.parse(match[1] ?? "") : undefined;
	} catch {
		return undefined;
	}
}

function collectUsefulStrings(
	value: unknown,
	parentKey = "",
	out: string[] = [],
): string[] {
	if (typeof value === "string") {
		if (TEXT_KEYS.has(parentKey) || looksLikeSentence(value)) out.push(value);
		return out;
	}
	if (Array.isArray(value)) {
		for (const entry of value) collectUsefulStrings(entry, parentKey, out);
		return out;
	}
	if (value && typeof value === "object") {
		for (const [key, entry] of Object.entries(
			value as Record<string, unknown>,
		)) {
			collectUsefulStrings(entry, key, out);
		}
	}
	return out;
}

function firstTitle(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const title = record.headline ?? record.title ?? record.name;
	if (typeof title === "string") return title;
	for (const entry of Object.values(record)) {
		const nested = firstTitle(entry);
		if (nested) return nested;
	}
	return undefined;
}

function looksLikeSentence(value: string): boolean {
	const text = value.trim();
	return text.length >= 40 && /\s/u.test(text) && !/^https?:\/\//iu.test(text);
}
