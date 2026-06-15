/** @file Pi tool adapter for stateful browser interaction. */
import { Type, type Static } from "typebox";

import {
	browserEvaluate,
	browserExportCookies,
	browserLiveCapture,
	browserScreenshot,
	type PageLandmarks,
} from "../browser/capture.ts";
import { browserAct } from "../browser/playwright.ts";
import { resolveProxyParam } from "../http/proxy-pool.ts";
import { extractMarkdownHeadings } from "../parse/markup/doc.ts";
import { filterLines } from "../scrape/line-filter.ts";
import { formatLineMatchPreview } from "../scrape/line-preview.ts";
import {
	buildBrowserCapturePayload,
	buildBrowserEvaluatePayload,
	buildBrowserLiveCapturePayload,
	buildBrowserScreenshotPayload,
} from "../storage/browser-capture.ts";
import { storeResponse } from "../storage/responses/store.ts";
import { renderWebBrowserResult } from "../tui/renderers/browser.ts";
import { defineResultRenderer } from "../tui/tool-progress.ts";
import { toolResourceStatus } from "../tui/tool-resource.ts";
import { accent, muted, renderDynamicText } from "../tui/tui.ts";
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
	| "inspect"
	| "read"
	| "exportCookies"
	| "screenshot"
	| "evaluate"
>({
	enum: [
		"navigate",
		"click",
		"fill",
		"select",
		"inspect",
		"read",
		"exportCookies",
		"screenshot",
		"evaluate",
	],
});

/** Per-action glyph for the call header: `web_browser > <glyph> <action>`. */
const ACTION_GLYPH: Record<string, string> = {
	navigate: "🧭",
	click: "🖱️",
	fill: "📝",
	select: "🔽",
	inspect: "🔎",
	read: "🧠",
	exportCookies: "🍪",
	screenshot: "📸",
	evaluate: "⏳",
};

export const webBrowserSchema = Type.Object({
	action: actionSchema,
	sessionId: Type.Unsafe<string>({ description: "Required. Persistent page identity." }),
	url: Type.Optional(urlProperty()),
	selector: Type.Optional(
		Type.Unsafe<string>({
			description: "@eN ref from the latest inspect, or CSS",
		}),
	),
	value: Type.Optional(Type.Unsafe<string>({ description: "Value (fill/select)" })),
	timeoutSeconds: Type.Optional(Type.Unsafe<number>({})),
	browserBackend: Type.Optional(
		Type.Unsafe<"cloak" | "playwright">({ description: "cloak|playwright" }),
	),
	// Array rotates round-robin per call, but the proxy binds at session-context creation
	// (session-pool pins it) → "next proxy per new sessionId", not a mid-session IP swap.
	proxy: Type.Optional(
		Type.Unsafe<string | string[]>({
			type: ["string", "array"],
			description: "proxy URL(s); array rotates per new sessionId",
		}),
	),
	// timezone/locale/browserProfile bind at session creation only; new sessionId to change.
	timezone: Type.Optional(Type.Unsafe<string>({ description: "IANA tz at session start" })),
	locale: Type.Optional(Type.Unsafe<string>({ description: "BCP-47 locale at session start" })),
	browserProfile: Type.Optional(Type.Unsafe<string>({ description: "UA at session start" })),
	saveSession: Type.Optional(Type.Unsafe<boolean>({ description: "persist session to disk" })),
	storeCapture: Type.Optional(
		Type.Unsafe<boolean>({ description: "store full body → responseId" }),
	),
	capture: Type.Optional(Type.Unsafe<{ store?: boolean; ttlSeconds?: number }>({})),
	format: Type.Optional(outputFormatSchema),
	linesMatching: Type.Optional(
		Type.Unsafe<string[]>({ description: "read: grep patterns → snippets" }),
	),
	contextLines: Type.Optional(Type.Unsafe<number>({ description: "lines around each match" })),
	caseSensitive: Type.Optional(Type.Unsafe<boolean>({})),
	detail: Type.Optional(
		Type.Unsafe<"interactive" | "outline" | "full">({
			description: "inspect/navigate: outline|interactive|full",
		}),
	),
	scope: Type.Optional(Type.Unsafe<string>({ description: "inspect: subtree to scan (@eN/CSS)" })),
	roles: Type.Optional(Type.Unsafe<string[]>({ description: "inspect: filter to ARIA roles" })),
	syncCookiesToHttpSession: Type.Optional(
		Type.Unsafe<boolean>({ description: "copy cookies → fast/fingerprint jar" }),
	),
	targetSessionId: Type.Optional(
		Type.Unsafe<string>({ description: "exportCookies: destination sessionId" }),
	),
	scopeUrl: Type.Optional(urlProperty()),
	fullPage: Type.Optional(Type.Unsafe<boolean>({ description: "Full-page (default viewport)" })),
	script: Type.Optional(Type.Unsafe<string>({ description: "evaluate JS" })),
});

type Params = Static<typeof webBrowserSchema>;

export const webBrowserTool = defineWebTool({
	name: "web_browser",
	label: "Browser",
	description:
		"Drive a live page over steps; sessionId required (one-shot read → web_scrape mode=browser). Loop: navigate/inspect → read @eN refs → act by @eN/CSS → re-inspect (refs go stale after the page changes). Actions: navigate · click · fill · select · inspect · read · screenshot · evaluate · exportCookies. Reuse the sessionId in web_scrape/web_extract (mode=browser) for chunking/saveToFile/verticals.",
	parameters: webBrowserSchema,
	async execute(_id, params: Params, signal) {
		// Resolve once per call: an array rotates round-robin (global pointer in proxy-pool). The
		// chosen proxy binds at session-context creation (session-pool pins it) → an array yields
		// "next proxy per new sessionId", not a mid-session IP swap. New sessionId for a fresh IP.
		const resolvedProxy = resolveProxyParam(params.proxy);
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
				return await runExportCookies(params, resolvedProxy);
			}
			if (params.action === "read") {
				return await runCapture(params, resolvedProxy, signal);
			}
			if (params.action === "screenshot") {
				return await runScreenshot(params, resolvedProxy, signal);
			}
			if (params.action === "evaluate") {
				return await runEvaluate(params, resolvedProxy, signal);
			}

			// Tool-facing "inspect" maps to the internal browser "snapshot" primitive (a11y tree).
			const actionLabel = params.action;
			const r = await browserAct(
				{
					action: params.action === "inspect" ? "snapshot" : params.action,
					sessionId: params.sessionId,
					url: params.url,
					selector: params.selector,
					value: params.value,
					timeoutSeconds: params.timeoutSeconds,
					browserBackend: params.browserBackend,
					proxy: resolvedProxy,
					saveSession: params.saveSession,
					locale: params.locale,
					timezone: params.timezone,
					browserProfile: params.browserProfile,
					detail: snapshotDetail(params),
					scope: params.scope,
					roles: params.roles,
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
					proxy: resolvedProxy,
					locale: params.locale,
					timezone: params.timezone,
					browserProfile: params.browserProfile,
				});
				cookieNotice = `\n\n---\nAuth carry-over only: exported ${exported.cookieCount} cookie(s) for ${exported.scopeUrl} to HTTP session "${exported.targetSessionId}" (${exported.domains.join(", ") || "none"}).`;
			}

			const baseText = `${actionLabel} → ${r.url}\n\n${r.snapshot}${cookieNotice}`;
			if (!shouldStoreCapture(params)) {
				return toolResult({
					text: baseText,
					data: { ...r, action: actionLabel },
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
				action: actionLabel,
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
				data: { ...r, action: actionLabel, storedCapture: payload },
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
	renderCall: (args, theme, context) => {
		// ponytail: url omitted from the header — the loading/result bar carries it; keep selector.
		const glyph = ACTION_GLYPH[args.action];
		// VS16 emoji (e.g. 🖱️) are drawn 2 cols but counted as 1 by terminals, eating the
		// trailing space — pad them so every action shows one gap before its name.
		const gap = [...glyph].length > 1 ? "  " : " ";
		// read carries its mode rung in the header: needles present → "needle", else "map".
		// (match count is result-only; the result status line shows "read (N matches)".)
		const rawMatching = args.linesMatching as unknown;
		const hasNeedles =
			(Array.isArray(rawMatching) && rawMatching.length > 0) ||
			(typeof rawMatching === "string" && rawMatching.length > 0);
		const label = args.action === "read" ? `read > ${hasNeedles ? "needle" : "map"}` : args.action;
		const action = glyph ? `> ${glyph}${gap}${label}` : label;
		// name in accent like every other tool; the action segment muted.
		const header = [
			accent("web_browser", theme),
			muted(action, theme),
			args.selector ? accent(args.selector, theme) : "",
		]
			.filter(Boolean)
			.join(" ");
		// While navigating, show a loading bar with the URL — mirrors the done bar instead of a bare header.
		if (context?.isPartial && args.url) {
			const url = args.url;
			return defineResultRenderer({
				renderContent: (width) =>
					`${header}\n${toolResourceStatus({ url, state: "loading", width, theme })}`,
			});
		}
		return renderDynamicText(() => header);
	},
	renderResult: (result, { expanded }, theme) => renderWebBrowserResult(result, expanded, theme),
});

/**
 * Default snapshot detail per action. A bare `navigate` returns a cheap orientation outline (the
 * map rung); adding `scope`/`roles` (or an explicit `detail`) drills into the interactive list.
 * Other actions keep the interactive default (undefined → interactive in playwright).
 */
function snapshotDetail(params: Params): "interactive" | "outline" | "full" | undefined {
	if (params.detail) return params.detail;
	const narrowed = Boolean(params.scope) || (params.roles?.length ?? 0) > 0;
	return params.action === "navigate" && !narrowed ? "outline" : undefined;
}

/**
 * Cheap orientation digest for a needle-less read: word/link counts, heading outline (with line
 * numbers so the agent can target a section), and landmark summary. Undefined when the page has
 * neither headings nor landmarks (caller falls back to a short slice).
 */
function formatReadDigest(markdown: string, landmarks?: PageLandmarks): string | undefined {
	const headings = extractMarkdownHeadings(markdown).slice(0, 30);
	if (headings.length === 0 && !landmarks) return undefined;
	const words = markdown.trim() ? markdown.trim().split(/\s+/u).length : 0;
	const lines = [
		`${words.toLocaleString()} words · ${(landmarks?.links ?? 0).toLocaleString()} links`,
	];
	if (headings.length > 0) {
		lines.push("outline:");
		for (const h of headings) {
			const indent = "  ".repeat(Math.min(h.level - 1, 3));
			lines.push(`${indent}${"#".repeat(h.level)} ${h.text}  (line ${h.line})`);
		}
	}
	if (landmarks) {
		const parts = [
			landmarks.nav ? "nav" : undefined,
			landmarks.main ? "main" : undefined,
			landmarks.forms > 0 ? `${landmarks.forms} forms` : undefined,
			landmarks.buttons > 0 ? `${landmarks.buttons} buttons` : undefined,
		].filter(Boolean);
		if (parts.length > 0) lines.push(`landmarks: ${parts.join(", ")}`);
	}
	lines.push("→ linesMatching:[…] to read a section · responseId for full body");
	return lines.join("\n");
}

async function runCapture(params: Params, resolvedProxy: string | undefined, signal: AbortSignal) {
	const format = (params.format ?? "markdown") as OutputFormat;
	const captured = await browserLiveCapture(
		{
			sessionId: params.sessionId,
			format,
			browserBackend: params.browserBackend,
			proxy: resolvedProxy,
			saveSession: params.saveSession,
			timeoutSeconds: params.timeoutSeconds,
			locale: params.locale,
			timezone: params.timezone,
			browserProfile: params.browserProfile,
		},
		signal,
	);
	const textBody = captured.data.markdown ?? captured.data.text ?? captured.data.html ?? "";
	// Schema is Type.Unsafe (no runtime check) — a model may pass a bare string; coerce to array so
	// filterLines doesn't iterate it character-by-character and the renderer can .map() it safely.
	const rawMatching = params.linesMatching as unknown;
	const needles = Array.isArray(rawMatching)
		? (rawMatching as string[])
		: typeof rawMatching === "string" && rawMatching
			? [rawMatching]
			: undefined;
	const matches =
		needles && needles.length > 0
			? filterLines(textBody, needles, params.contextLines, params.caseSensitive)
			: undefined;
	const matchPreview = matches?.length
		? formatLineMatchPreview(matches, { maxChars: 4_000 })
		: undefined;
	// Needle-less read returns a cheap orientation digest (outline + landmarks), not the page body:
	// the agent reads that to pick needles, then reads targeted. Full body stays on responseId.
	const digest =
		needles && needles.length > 0 ? undefined : formatReadDigest(textBody, captured.landmarks);
	const snippet =
		needles && needles.length > 0
			? (matchPreview ?? `No lines matched: ${needles.map((n) => `"${n}"`).join(", ")}`)
			: (digest ?? textBody.slice(0, 800));
	// Tag the rung so the agent sees at a glance which mode it got: map (orientation), N matches
	// (targeted), or no match. Full body is a separate responseId retrieval.
	const readMode =
		needles && needles.length > 0
			? matches && matches.length > 0
				? `${matches.length} match${matches.length === 1 ? "" : "es"}`
				: "no match"
			: "map";
	const baseText = `read (${format} · ${readMode}) → ${captured.url}\n\n${snippet}`;
	const excerpt = matchPreview ?? textBody;

	if (!shouldStoreCapture(params)) {
		return toolResult({
			text: baseText,
			data: { ...captured, action: "read", matches, needles, digest },
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
				excerpt,
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
		excerpt,
	});
	return toolResult({
		text: `${baseText}\n\nresponseId: ${stored.responseId}`,
		data: { ...captured, action: "read", storedCapture: payload, matches, needles, digest },
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

async function runExportCookies(params: Params, resolvedProxy: string | undefined) {
	const exported = await browserExportCookies({
		sessionId: params.sessionId,
		targetSessionId: params.targetSessionId,
		scopeUrl: params.scopeUrl!,
		browserBackend: params.browserBackend,
		proxy: resolvedProxy,
		locale: params.locale,
		timezone: params.timezone,
		browserProfile: params.browserProfile,
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

async function runScreenshot(
	params: Params,
	resolvedProxy: string | undefined,
	signal: AbortSignal,
) {
	const shot = await browserScreenshot(
		{
			sessionId: params.sessionId,
			fullPage: params.fullPage,
			selector: params.selector,
			browserBackend: params.browserBackend,
			proxy: resolvedProxy,
			saveSession: params.saveSession,
			timeoutSeconds: params.timeoutSeconds,
			locale: params.locale,
			timezone: params.timezone,
			browserProfile: params.browserProfile,
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

async function runEvaluate(params: Params, resolvedProxy: string | undefined, signal: AbortSignal) {
	const ev = await browserEvaluate(
		{
			sessionId: params.sessionId,
			script: params.script!,
			browserBackend: params.browserBackend,
			proxy: resolvedProxy,
			saveSession: params.saveSession,
			timeoutSeconds: params.timeoutSeconds,
			locale: params.locale,
			timezone: params.timezone,
			browserProfile: params.browserProfile,
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
