/** @file Pi tool adapter for stateful browser interaction. */
import { Type, type Static } from "typebox";

import {
	browserEvaluate,
	browserExportCookies,
	browserLiveCapture,
	browserScreenshot,
} from "../browser/capture.ts";
import { browserAct } from "../browser/playwright.ts";
import {
	buildBrowserCapturePayload,
	buildBrowserEvaluatePayload,
	buildBrowserLiveCapturePayload,
	buildBrowserScreenshotPayload,
} from "../storage/browser-capture.ts";
import { storeResponse } from "../storage/responses/store.ts";
import { toolCall } from "../tui/index.ts";
import { renderWebBrowserResult } from "../tui/renderers/browser.ts";
import type { OutputFormat } from "../types.ts";
import {
	browserCookieBridgeGuidance,
	browserStoredCaptureContext,
} from "./infra/agentic-context.ts";
import { defineWebTool } from "./infra/define.ts";
import { inputErrorResult, toolErrorResult, toolResult } from "./infra/result.ts";
import { outputFormatSchema, urlProperty } from "./infra/schemas.ts";

const actionSchema = Type.Unsafe<
	| "navigate"
	| "click"
	| "fill"
	| "select"
	| "snapshot"
	| "capture"
	| "exportCookies"
	| "screenshot"
	| "evaluate"
>({
	enum: [
		"navigate",
		"click",
		"fill",
		"select",
		"snapshot",
		"capture",
		"exportCookies",
		"screenshot",
		"evaluate",
	],
});

export const webBrowserSchema = Type.Object({
	action: actionSchema,
	sessionId: Type.Unsafe<string>({ description: "Required. Persistent page identity." }),
	url: Type.Optional(urlProperty()),
	selector: Type.Optional(
		Type.Unsafe<string>({
			description:
				"CSS selector, or @eN ref from the latest snapshot (stale after the page changes)",
		}),
	),
	value: Type.Optional(Type.Unsafe<string>({ description: "Value (fill/select)" })),
	timeoutSeconds: Type.Optional(Type.Unsafe<number>({})),
	browserBackend: Type.Optional(
		Type.Unsafe<"cloak" | "playwright">({ description: "cloak|playwright" }),
	),
	proxy: Type.Optional(Type.Unsafe<string>({})),
	saveSession: Type.Optional(Type.Unsafe<boolean>({})),
	storeCapture: Type.Optional(Type.Unsafe<boolean>({})),
	capture: Type.Optional(Type.Unsafe<{ store?: boolean; ttlSeconds?: number }>({})),
	format: Type.Optional(outputFormatSchema),
	syncCookiesToHttpSession: Type.Optional(Type.Unsafe<boolean>({})),
	targetSessionId: Type.Optional(Type.Unsafe<string>({})),
	scopeUrl: Type.Optional(urlProperty()),
	fullPage: Type.Optional(Type.Unsafe<boolean>({ description: "Full-page (default viewport)" })),
	script: Type.Optional(Type.Unsafe<string>({ description: "evaluate JS" })),
});

type Params = Static<typeof webBrowserSchema>;

export const webBrowserTool = defineWebTool({
	name: "web_browser",
	label: "Browser",
	description:
		"Drive live page: navigate|click|fill|select|snapshot|capture|exportCookies|screenshot|evaluate. sessionId required.",
	parameters: webBrowserSchema,
	async execute(_id, params: Params, signal) {
		if (!params.sessionId)
			return inputErrorResult(
				"BROWSER_SESSION_MISSING",
				"browser",
				"web_browser requires sessionId.",
			);
		if (params.action === "navigate" && !params.url)
			return inputErrorResult("BROWSER_URL_MISSING", "browser", "navigate requires url.");
		if (["click", "fill", "select"].includes(params.action) && !params.selector)
			return inputErrorResult(
				"BROWSER_SELECTOR_MISSING",
				"browser",
				`${params.action} requires selector.`,
			);
		if (params.action === "exportCookies" && !params.scopeUrl)
			return inputErrorResult(
				"BROWSER_SCOPE_URL_MISSING",
				"browser",
				"exportCookies requires scopeUrl.",
			);
		if (params.syncCookiesToHttpSession && !params.scopeUrl)
			return inputErrorResult(
				"BROWSER_SCOPE_URL_MISSING",
				"browser",
				"syncCookiesToHttpSession requires scopeUrl.",
			);
		if (params.action === "evaluate" && !params.script)
			return inputErrorResult("BROWSER_SCRIPT_MISSING", "browser", "evaluate requires script.");

		try {
			if (params.action === "exportCookies") {
				return await runExportCookies(params);
			}
			if (params.action === "capture") {
				return await runCapture(params, signal);
			}
			if (params.action === "screenshot") {
				return await runScreenshot(params, signal);
			}
			if (params.action === "evaluate") {
				return await runEvaluate(params, signal);
			}

			const r = await browserAct(
				{
					action: params.action,
					sessionId: params.sessionId,
					url: params.url,
					selector: params.selector,
					value: params.value,
					timeoutSeconds: params.timeoutSeconds,
					browserBackend: params.browserBackend,
					proxy: params.proxy,
					saveSession: params.saveSession,
				},
				signal,
			);
			let cookieNotice = "";
			if (params.syncCookiesToHttpSession && params.scopeUrl) {
				const exported = await browserExportCookies({
					sessionId: params.sessionId,
					targetSessionId: params.targetSessionId,
					scopeUrl: params.scopeUrl,
					browserBackend: params.browserBackend,
					proxy: params.proxy,
				});
				cookieNotice = `\n\n---\nAuth carry-over only: exported ${exported.cookieCount} cookie(s) for ${exported.scopeUrl} to HTTP session "${exported.targetSessionId}" (${exported.domains.join(", ") || "none"}).`;
			}

			const baseText = `${r.action} → ${r.url}\n\n${r.snapshot}${cookieNotice}`;
			if (!shouldStoreCapture(params)) {
				return toolResult({
					text: baseText,
					data: r,
					url: r.url,
					status: r.status,
					mode: r.backend,
					timing: { durationMs: r.durationMs },
					assistantGuidance: params.syncCookiesToHttpSession
						? browserCookieBridgeGuidance()
						: undefined,
				});
			}

			const payload = buildBrowserCapturePayload({
				sessionId: params.sessionId,
				action: r.action,
				url: r.url,
				backend: r.backend,
				snapshot: r.snapshot,
			});
			const stored = await storeResponse(payload, captureStoreOptions(params));
			const agentic = browserStoredCaptureContext({
				responseId: stored.responseId,
				url: r.url,
				captureKind: "browser_capture",
				excerpt: r.snapshot,
			});
			return toolResult({
				text: `${baseText}\n\nresponseId: ${stored.responseId}`,
				data: { ...r, storedCapture: payload },
				url: r.url,
				status: r.status,
				mode: r.backend,
				timing: { durationMs: r.durationMs },
				responseId: stored.responseId,
				fullOutputPath: stored.fullOutputPath,
				...agentic,
			});
		} catch (e) {
			return toolErrorResult(e, "BROWSER_ACTION_FAILED", "browser", params.url);
		}
	},
	renderCall: (args, theme) =>
		toolCall("web_browser", [args.action, args.selector ?? args.url ?? ""].filter(Boolean), theme),
	renderResult: (result, { expanded }, theme) => renderWebBrowserResult(result, expanded, theme),
});

async function runCapture(params: Params, signal: AbortSignal) {
	const format = (params.format ?? "markdown") as OutputFormat;
	const captured = await browserLiveCapture(
		{
			sessionId: params.sessionId,
			format,
			browserBackend: params.browserBackend,
			proxy: params.proxy,
			saveSession: params.saveSession,
			timeoutSeconds: params.timeoutSeconds,
		},
		signal,
	);
	const textBody = captured.data.markdown ?? captured.data.text ?? captured.data.html ?? "";
	const baseText = `capture (${format}) → ${captured.url}\n\n${textBody.slice(0, 4000)}`;

	if (!shouldStoreCapture(params)) {
		return toolResult({
			text: baseText,
			data: captured,
			url: captured.url,
			finalUrl: captured.finalUrl,
			status: captured.status,
			mode: captured.backend,
			format,
			timing: { durationMs: captured.durationMs },
			assistantGuidance: browserStoredCaptureContext({
				responseId: "n/a",
				url: captured.url,
				captureKind: "browser_live_capture",
				excerpt: textBody,
			}).assistantGuidance,
		});
	}

	const payload = buildBrowserLiveCapturePayload({
		sessionId: params.sessionId,
		url: captured.url,
		finalUrl: captured.finalUrl,
		backend: captured.backend,
		format,
		status: captured.status,
		data: captured.data,
	});
	const stored = await storeResponse(payload, captureStoreOptions(params));
	const agentic = browserStoredCaptureContext({
		responseId: stored.responseId,
		url: captured.url,
		captureKind: "browser_live_capture",
		excerpt: textBody,
	});
	return toolResult({
		text: `${baseText}\n\nresponseId: ${stored.responseId}`,
		data: { ...captured, storedCapture: payload },
		url: captured.url,
		finalUrl: captured.finalUrl,
		status: captured.status,
		mode: captured.backend,
		format,
		timing: { durationMs: captured.durationMs },
		responseId: stored.responseId,
		fullOutputPath: stored.fullOutputPath,
		...agentic,
	});
}

async function runExportCookies(params: Params) {
	const exported = await browserExportCookies({
		sessionId: params.sessionId,
		targetSessionId: params.targetSessionId,
		scopeUrl: params.scopeUrl!,
		browserBackend: params.browserBackend,
		proxy: params.proxy,
	});
	const text = `exportCookies → HTTP session "${exported.targetSessionId}" for ${exported.scopeUrl}: ${exported.cookieCount} cookie(s) across ${exported.domains.join(", ") || "no domains"}. Auth carry-over only.`;
	return toolResult({
		text,
		data: exported,
		url: exported.scopeUrl,
		summary: text,
		answerContext:
			"Browser cookies were exported to the named HTTP session for fast/fingerprint requests. Cookie values are not included in this output.",
		assistantGuidance: browserCookieBridgeGuidance(),
	});
}

async function runScreenshot(params: Params, signal: AbortSignal) {
	const shot = await browserScreenshot(
		{
			sessionId: params.sessionId,
			fullPage: params.fullPage,
			selector: params.selector,
			browserBackend: params.browserBackend,
			proxy: params.proxy,
			saveSession: params.saveSession,
			timeoutSeconds: params.timeoutSeconds,
		},
		signal,
	);
	const payload = buildBrowserScreenshotPayload({
		sessionId: params.sessionId,
		url: shot.url,
		backend: shot.backend,
		fullPage: shot.fullPage,
		selector: shot.selector,
		blobPath: shot.blobPath,
		byteLength: shot.byteLength,
	});
	const stored = await storeResponse(payload, captureStoreOptions(params));
	const modeLabel = shot.fullPage
		? "full-page"
		: shot.selector
			? `element:${shot.selector}`
			: "viewport";
	// "saved:" points at the PNG blob (openable image), not stored.fullOutputPath (the JSON payload).
	const text = `screenshot → ${shot.url} [${modeLabel}] saved: ${shot.blobPath} (responseId: ${stored.responseId})`;
	return toolResult({
		text,
		data: { ...shot, action: "screenshot", storedCapture: payload },
		url: shot.url,
		mode: shot.backend,
		timing: { durationMs: shot.durationMs },
		responseId: stored.responseId,
		fullOutputPath: stored.fullOutputPath,
	});
}

async function runEvaluate(params: Params, signal: AbortSignal) {
	const ev = await browserEvaluate(
		{
			sessionId: params.sessionId,
			script: params.script!,
			browserBackend: params.browserBackend,
			proxy: params.proxy,
			saveSession: params.saveSession,
			timeoutSeconds: params.timeoutSeconds,
		},
		signal,
	);
	const truncNote = ev.truncated ? " [result truncated at 10 000 chars]" : "";
	const text = `evaluate → ${ev.url}${truncNote}\n\n${ev.result}`;

	if (!shouldStoreCapture(params)) {
		return toolResult({
			text,
			data: { ...ev, action: "evaluate" },
			url: ev.url,
			mode: ev.backend,
			timing: { durationMs: ev.durationMs },
		});
	}

	const payload = buildBrowserEvaluatePayload({
		sessionId: params.sessionId,
		url: ev.url,
		backend: ev.backend,
		result: ev.result,
		truncated: ev.truncated,
	});
	const stored = await storeResponse(payload, captureStoreOptions(params));
	return toolResult({
		text: `${text}\n\nresponseId: ${stored.responseId}`,
		data: { ...ev, action: "evaluate", storedCapture: payload },
		url: ev.url,
		mode: ev.backend,
		timing: { durationMs: ev.durationMs },
		responseId: stored.responseId,
		fullOutputPath: stored.fullOutputPath,
	});
}

function shouldStoreCapture(params: Params): boolean {
	return params.storeCapture === true || params.capture?.store === true;
}

function captureStoreOptions(params: Params) {
	return params.capture?.ttlSeconds ? { ttlSeconds: params.capture.ttlSeconds } : {};
}
