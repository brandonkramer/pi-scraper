/** @file Typed stored payloads for web_browser captures (distinct from scrape diff snapshots). */
import type { ScrapeData } from "../scrape/pipeline.ts";
import type { BrowserBackend, OutputFormat } from "../types.ts";

export const BROWSER_CAPTURE_KIND = "browser_capture" as const;
export const BROWSER_LIVE_CAPTURE_KIND = "browser_live_capture" as const;
export const BROWSER_SCREENSHOT_KIND = "browser_screenshot" as const;
export const BROWSER_EVALUATE_KIND = "browser_evaluate" as const;

export type BrowserCaptureKind =
	| typeof BROWSER_CAPTURE_KIND
	| typeof BROWSER_LIVE_CAPTURE_KIND
	| typeof BROWSER_SCREENSHOT_KIND
	| typeof BROWSER_EVALUATE_KIND;

/** Immutable evidence from an interactive browser snapshot (a11y tree). */
export interface BrowserCapturePayload {
	kind: typeof BROWSER_CAPTURE_KIND;
	version: 1;
	sourceTool: "web_browser";
	sessionId: string;
	action: string;
	url: string;
	capturedAt: string;
	backend: BrowserBackend;
	capture: {
		snapshotType: "interactive-a11y";
		snapshot: string;
	};
}

/** Materialized live-page DOM content after browser interaction (no re-navigation). */
export interface BrowserLiveCapturePayload {
	kind: typeof BROWSER_LIVE_CAPTURE_KIND;
	version: 1;
	sourceTool: "web_browser";
	sessionId: string;
	url: string;
	finalUrl?: string;
	capturedAt: string;
	backend: BrowserBackend;
	format: OutputFormat | string;
	status?: number;
	data: ScrapeData;
}

/** PNG screenshot of the live page (disk artifact; not inline in tool content). */
export interface BrowserScreenshotPayload {
	kind: typeof BROWSER_SCREENSHOT_KIND;
	version: 1;
	sourceTool: "web_browser";
	sessionId: string;
	url: string;
	capturedAt: string;
	backend: BrowserBackend;
	fullPage: boolean;
	selector?: string;
	blobPath: string;
	byteLength: number;
}

/** JSON-serialized page.evaluate result (script source not stored). */
export interface BrowserEvaluatePayload {
	kind: typeof BROWSER_EVALUATE_KIND;
	version: 1;
	sourceTool: "web_browser";
	sessionId: string;
	url: string;
	capturedAt: string;
	backend: BrowserBackend;
	truncated: boolean;
	result: string;
}

export type StoredBrowserPayload =
	| BrowserCapturePayload
	| BrowserLiveCapturePayload
	| BrowserScreenshotPayload
	| BrowserEvaluatePayload;

export function isBrowserCapturePayload(value: unknown): value is BrowserCapturePayload {
	return (value as { kind?: unknown } | null)?.kind === BROWSER_CAPTURE_KIND;
}

export function isBrowserLiveCapturePayload(value: unknown): value is BrowserLiveCapturePayload {
	return (value as { kind?: unknown } | null)?.kind === BROWSER_LIVE_CAPTURE_KIND;
}

export function buildBrowserCapturePayload(input: {
	sessionId: string;
	action: string;
	url: string;
	backend: BrowserBackend;
	snapshot: string;
}): BrowserCapturePayload {
	return {
		kind: BROWSER_CAPTURE_KIND,
		version: 1,
		sourceTool: "web_browser",
		sessionId: input.sessionId,
		action: input.action,
		url: input.url,
		capturedAt: new Date().toISOString(),
		backend: input.backend,
		capture: {
			snapshotType: "interactive-a11y",
			snapshot: input.snapshot,
		},
	};
}

export function buildBrowserLiveCapturePayload(input: {
	sessionId: string;
	url: string;
	finalUrl?: string;
	backend: BrowserBackend;
	format: OutputFormat | string;
	status?: number;
	data: ScrapeData;
}): BrowserLiveCapturePayload {
	return {
		kind: BROWSER_LIVE_CAPTURE_KIND,
		version: 1,
		sourceTool: "web_browser",
		sessionId: input.sessionId,
		url: input.url,
		finalUrl: input.finalUrl,
		capturedAt: new Date().toISOString(),
		backend: input.backend,
		format: input.format,
		status: input.status,
		data: input.data,
	};
}

export function buildBrowserScreenshotPayload(input: {
	sessionId: string;
	url: string;
	backend: BrowserBackend;
	fullPage: boolean;
	selector?: string;
	blobPath: string;
	byteLength: number;
}): BrowserScreenshotPayload {
	return {
		kind: BROWSER_SCREENSHOT_KIND,
		version: 1,
		sourceTool: "web_browser",
		sessionId: input.sessionId,
		url: input.url,
		capturedAt: new Date().toISOString(),
		backend: input.backend,
		fullPage: input.fullPage,
		selector: input.selector,
		blobPath: input.blobPath,
		byteLength: input.byteLength,
	};
}

export function buildBrowserEvaluatePayload(input: {
	sessionId: string;
	url: string;
	backend: BrowserBackend;
	result: string;
	truncated: boolean;
}): BrowserEvaluatePayload {
	return {
		kind: BROWSER_EVALUATE_KIND,
		version: 1,
		sourceTool: "web_browser",
		sessionId: input.sessionId,
		url: input.url,
		capturedAt: new Date().toISOString(),
		backend: input.backend,
		truncated: input.truncated,
		result: input.result,
	};
}
