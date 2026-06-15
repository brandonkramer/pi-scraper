/** @file Primary source resolution for web_extract (content | url | responseId). */
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import {
	isBrowserCapturePayload,
	isBrowserLiveCapturePayload,
} from "../../storage/browser-capture.ts";
import type { ResolveStorageOptions } from "../../storage/paths.ts";
import { readResponse } from "../../storage/responses/read.ts";
import type { PiToolShell, ToolContext } from "../../types.ts";
import { inputErrorResult } from "./result.ts";

export type ExtractStoredSourceKind =
	| "stored_browser_capture"
	| "stored_live_capture"
	| "stored_scrape";

export interface ExtractSourceResolution {
	primary: "content" | "url" | "responseId";
	storedKind?: ExtractStoredSourceKind;
	content: string;
	html?: string;
	url?: string;
	responseId?: string;
	scrape?: ScrapeResult;
}

export interface ExtractSourceParams {
	content?: string;
	url?: string;
	responseId?: string;
}

export function countPrimarySources(params: ExtractSourceParams): number {
	let count = 0;
	if (params.content?.trim()) count++;
	if (params.url) count++;
	if (params.responseId) count++;
	return count;
}

export function primarySourceConflictResult(phase: string): PiToolShell<ToolContext<undefined>> {
	return inputErrorResult(
		"EXTRACT_SOURCE_AMBIGUOUS",
		phase,
		"Provide exactly one primary source: content, url, or responseId.",
		"Use only one of content, url, or responseId as the extraction input source.",
	);
}

export async function resolveExtractSource(
	params: ExtractSourceParams,
	phase: string,
	options: { requireHtml?: boolean; storage?: ResolveStorageOptions } = {},
): Promise<ExtractSourceResolution | PiToolShell<ToolContext<undefined>>> {
	if (countPrimarySources(params) > 1) return primarySourceConflictResult(phase);

	if (params.content?.trim()) {
		return {
			primary: "content",
			content: params.content,
			html: looksLikeHtml(params.content) ? params.content : undefined,
			url: params.url,
		};
	}

	if (params.responseId) {
		return await resolveStoredSource(params.responseId, phase, options);
	}

	if (params.url) {
		return { primary: "url", content: "", url: params.url };
	}

	return inputErrorResult(
		"EXTRACT_INPUT_MISSING",
		phase,
		"web_extract requires content, url, or responseId.",
		"Provide content, url, or responseId for extraction.",
	);
}

async function resolveStoredSource(
	responseId: string,
	phase: string,
	options: { requireHtml?: boolean; storage?: ResolveStorageOptions },
): Promise<ExtractSourceResolution | PiToolShell<ToolContext<undefined>>> {
	try {
		const stored = await readResponse(responseId, options.storage ?? {});
		const value = stored.value;

		if (isBrowserCapturePayload(value)) {
			if (options.requireHtml) {
				return inputErrorResult(
					"EXTRACT_SOURCE_NO_HTML",
					phase,
					"Selector extraction requires HTML, but the stored browser capture only includes an accessibility snapshot.",
					"Use web_browser action=capture with format=html and storeCapture, or extract from a stored scrape result.",
				);
			}
			return {
				primary: "responseId",
				storedKind: "stored_browser_capture",
				content: value.capture.snapshot,
				url: value.url,
				responseId,
			};
		}

		if (isBrowserLiveCapturePayload(value)) {
			const html = value.data.html;
			const text = value.data.markdown ?? value.data.text ?? value.data.rawText ?? html ?? "";
			if (options.requireHtml && !html) {
				return inputErrorResult(
					"EXTRACT_SOURCE_NO_HTML",
					phase,
					"Selector extraction requires HTML, but the stored live capture has no HTML.",
					"Re-capture with web_browser action=capture format=html storeCapture:true.",
				);
			}
			return {
				primary: "responseId",
				storedKind: "stored_live_capture",
				content: text,
				html,
				url: value.finalUrl ?? value.url,
				responseId,
			};
		}

		const scrape = value as ScrapeResult;
		// Read data through an optional view: `value` is unknown, so a stored result
		// that isn't a scrape (no data) is handled instead of trusting the cast.
		const data = (value as { data?: ScrapeResult["data"] }).data;
		if (data) {
			const html = data.html;
			const text = data.markdown ?? data.text ?? data.rawText ?? html ?? "";
			if (options.requireHtml && !html) {
				return inputErrorResult(
					"EXTRACT_SOURCE_NO_HTML",
					phase,
					"Selector extraction requires HTML, but the stored scrape result has no HTML.",
					"Scrape with format=html or use a stored live capture that includes HTML.",
				);
			}
			if (!text && !html) {
				return inputErrorResult(
					"EXTRACT_SOURCE_EMPTY",
					phase,
					`Stored result ${responseId} has no extractable text content.`,
				);
			}
			return {
				primary: "responseId",
				storedKind: "stored_scrape",
				content: text,
				html,
				url: scrape.finalUrl ?? scrape.url,
				responseId,
				scrape,
			};
		}

		return inputErrorResult(
			"EXTRACT_SOURCE_UNSUPPORTED",
			phase,
			`Stored result ${responseId} is not a supported extraction source.`,
			"Use a browser capture, live capture, or single-page scrape responseId.",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Stored result not found.";
		return inputErrorResult("STORED_RESULT_NOT_FOUND", phase, message);
	}
}

export function storedSourceNote(resolution: ExtractSourceResolution): {
	label: string;
	description: string;
} {
	if (resolution.storedKind === "stored_browser_capture") {
		return {
			label: "browser capture",
			description:
				"Immutable accessibility snapshot evidence. @eN element refs are not durable action handles.",
		};
	}
	if (resolution.storedKind === "stored_live_capture") {
		return {
			label: "live-page capture",
			description: "Live DOM content captured without re-navigation after browser interaction.",
		};
	}
	if (resolution.storedKind === "stored_scrape") {
		return {
			label: "stored scrape",
			description: "Previously stored single-page scrape result used as extraction evidence.",
		};
	}
	return { label: "provided content", description: "Inline caller-provided content." };
}

function looksLikeHtml(content: string): boolean {
	const trimmed = content.trimStart().toLowerCase();
	return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

export function isExtractSourceResolution(
	value: ExtractSourceResolution | PiToolShell<ToolContext<undefined>>,
): value is ExtractSourceResolution {
	return "primary" in value;
}
