/**
 * @fileoverview diff normalize module.
 */
import type { ScrapeResult } from "../scrape/pipeline.ts";

export interface SnapshotLink {
	url: string;
	text?: string;
	rel?: string;
}

export interface NormalizedSnapshotContent {
	url: string;
	finalUrl?: string;
	title?: string;
	rawText: string;
	text: string;
	headings: string[];
	links: SnapshotLink[];
	metadata: Record<string, string>;
	paragraphs: string[];
}

export function normalizeScrapeForSnapshot(
	result: ScrapeResult,
): NormalizedSnapshotContent {
	const rawText = normalizeSnapshotText(
		result.data.markdown ?? result.data.text ?? "",
	);
	const text = normalizeVolatileSnapshotText(rawText);
	const metadata = snapshotMetadata(result);
	const title = result.data.title ?? metadata.title;
	return {
		url: result.url ?? "",
		finalUrl: result.finalUrl,
		title,
		rawText,
		text,
		headings: headingsFromText(rawText),
		links: snapshotLinks(result.data.links),
		metadata,
		paragraphs: paragraphsFromText(rawText),
	};
}

export function normalizeSnapshotText(text: string): string {
	return text
		.replace(/\r\n?/gu, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.join("\n");
}

export function normalizeVolatileSnapshotText(text: string): string {
	return normalizeSnapshotText(text)
		.split("\n")
		.map((line) =>
			line
				.replace(
					/\b(last updated|updated|posted)\s+(?:about\s+)?\d+\s+(seconds?|minutes?|hours?|days?)\s+ago\b/giu,
					"$1 <relative-time>",
				)
				.replace(
					/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu,
					"<timestamp>",
				)
				.replace(
					/\b(?:csrf|xsrf|session|sid|nonce|token)=['"]?[A-Za-z0-9._:-]{12,}['"]?/giu,
					"token=<volatile-token>",
				)
				.replace(
					/\b(?:ad-slot|ad_unit|google_ads_iframe)[:=_-][A-Za-z0-9._-]{6,}\b/giu,
					"ad-slot=<volatile-ad-slot>",
				)
				.replace(/https?:\/\/[^\s)]+/giu, stripTrackingParams),
		)
		.join("\n");
}

function stripTrackingParams(urlText: string): string {
	try {
		const url = new URL(urlText);
		for (const key of [...url.searchParams.keys()]) {
			if (/^(utm_|fbclid$|gclid$|msclkid$|yclid$|mc_cid$|mc_eid$)/iu.test(key))
				url.searchParams.delete(key);
			if (/^(session|sid|csrf|xsrf|nonce|token)$/iu.test(key))
				url.searchParams.set(key, "<volatile-token>");
		}
		return url.toString();
	} catch {
		return urlText;
	}
}

function headingsFromText(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.match(/^#{1,6}\s+(.+)$/u)?.[1]?.trim())
		.filter((line): line is string => Boolean(line))
		.slice(0, 100);
}

function paragraphsFromText(text: string): string[] {
	return text
		.split("\n")
		.filter((line) => !/^#{1,6}\s+/u.test(line))
		.filter((line) => line.length >= 24)
		.slice(0, 100);
}

function snapshotLinks(links: unknown[] | undefined): SnapshotLink[] {
	const seen = new Set<string>();
	const result: SnapshotLink[] = [];
	for (const link of links ?? []) {
		if (typeof link !== "object" || link === null) continue;
		const record = link as Record<string, unknown>;
		if (typeof record.url !== "string" || seen.has(record.url)) continue;
		seen.add(record.url);
		result.push({
			url: record.url,
			text: typeof record.text === "string" ? record.text : undefined,
			rel: typeof record.rel === "string" ? record.rel : undefined,
		});
	}
	return result.slice(0, 200);
}

function snapshotMetadata(result: ScrapeResult): Record<string, string> {
	const entries: Record<string, string> = {};
	if (result.data.title) entries.title = result.data.title;
	if (result.data.description) entries.description = result.data.description;
	flattenMetadata(entries, "metadata", result.data.metadata);
	return Object.fromEntries(
		Object.entries(entries).sort(([left], [right]) =>
			left.localeCompare(right),
		),
	);
}

function flattenMetadata(
	output: Record<string, string>,
	prefix: string,
	value: unknown,
): void {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		output[prefix] = String(value);
		return;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return;
	for (const [key, nested] of Object.entries(
		value as Record<string, unknown>,
	)) {
		flattenMetadata(output, `${prefix}.${key}`, nested);
	}
}
