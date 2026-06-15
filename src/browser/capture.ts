/**
 * @file Live-page capture, screenshot, evaluate, and browser→HTTP cookie bridge for web_browser
 *   continuity.
 */
import { DEFAULT_BROWSER_BACKEND } from "../defaults.ts";
import { resolveEnvProxyForUrl } from "../http/proxy-config.ts";
import { getOrCreateSession, persistSession } from "../http/session.ts";
import { assertSafeFetchUrl } from "../http/url-safety.ts";
import { responseScrape } from "../scrape/modes/fast.ts";
import { finishResult, materializeFormat } from "../scrape/render.ts";
import { writeBlob } from "../storage/blobs.ts";
import type { OutputFormat } from "../types.ts";
import { acquireSessionPage, selectorOf } from "./playwright.ts";
import type { BrowserActDeps, BrowserBackend } from "./playwright.ts";
import { validateSessionId } from "./session.ts";

export interface BrowserLiveCaptureInput {
	sessionId: string;
	format?: OutputFormat;
	browserBackend?: BrowserBackend;
	proxy?: string;
	saveSession?: boolean;
	timeoutSeconds?: number;
}

export interface BrowserLiveCaptureResult {
	url: string;
	finalUrl: string;
	status?: number;
	backend: BrowserBackend;
	format: OutputFormat;
	durationMs: number;
	data: Awaited<ReturnType<typeof responseScrape>>["data"];
}

export interface BrowserExportCookiesInput {
	sessionId: string;
	targetSessionId?: string;
	scopeUrl: string;
	browserBackend?: BrowserBackend;
	proxy?: string;
}

export interface BrowserExportCookiesResult {
	sourceSessionId: string;
	targetSessionId: string;
	scopeUrl: string;
	cookieCount: number;
	domains: string[];
}

export interface BrowserScreenshotInput {
	sessionId: string;
	fullPage?: boolean;
	selector?: string;
	browserBackend?: BrowserBackend;
	proxy?: string;
	saveSession?: boolean;
	timeoutSeconds?: number;
}

export interface BrowserScreenshotResult {
	url: string;
	backend: BrowserBackend;
	blobPath: string;
	byteLength: number;
	width: number;
	height: number;
	fullPage: boolean;
	selector?: string;
	durationMs: number;
}

export interface BrowserEvaluateInput {
	sessionId: string;
	script: string;
	browserBackend?: BrowserBackend;
	proxy?: string;
	saveSession?: boolean;
	timeoutSeconds?: number;
}

export interface BrowserEvaluateResult {
	url: string;
	backend: BrowserBackend;
	result: string;
	truncated: boolean;
	durationMs: number;
}

export async function browserLiveCapture(
	input: BrowserLiveCaptureInput,
	signal?: AbortSignal,
	deps: BrowserActDeps = {},
): Promise<BrowserLiveCaptureResult> {
	const startedAt = Date.now();
	validateSessionId(input.sessionId);
	const backend = input.browserBackend ?? DEFAULT_BROWSER_BACKEND;
	const format = input.format ?? "markdown";
	const safetyCheck = assertSafeFetchUrl;
	const effectiveProxy = input.proxy ? resolveEnvProxyForUrl(input.proxy) : undefined;
	const renderOptions = {
		sessionId: input.sessionId,
		saveSession: input.saveSession,
		browserBackend: backend,
		proxy: effectiveProxy,
	};
	const browserLoader = deps.browserLoader;

	const { page } = await acquireSessionPage({
		options: renderOptions,
		backend,
		safetyCheck,
		effectiveProxy,
		reusePage: true,
		browserLoader,
	});

	if (signal?.aborted) throw new Error("Browser capture aborted");

	await pierceShadowRoots(page);
	const html = await page.content();
	// reusePage:true means this is the persistent session page. Strip the wrappers
	// pierceShadowRoots injected, else repeat captures compound duplicated shadow content
	// and pollute later click/fill/snapshot actions.
	await removeShadowContentWrappers(page);
	const url = page.url();
	const finalUrl = page.url();

	const response = {
		url,
		finalUrl,
		status: 200,
		headers: { "content-type": "text/html" },
		contentType: "text/html",
		text: html,
		downloadedBytes: Buffer.byteLength(html),
	};

	let scrape = await responseScrape(response, "browser", format, {}, signal);
	scrape = materializeFormat(scrape, format, {});
	scrape = finishResult(scrape, new Date(startedAt));

	return {
		url,
		finalUrl,
		status: scrape.status,
		backend,
		format,
		durationMs: Date.now() - startedAt,
		data: scrape.data,
	};
}

export async function browserExportCookies(
	input: BrowserExportCookiesInput,
	deps: BrowserActDeps = {},
): Promise<BrowserExportCookiesResult> {
	validateSessionId(input.sessionId);
	const targetSessionId = input.targetSessionId ?? input.sessionId;
	validateSessionId(targetSessionId);

	// assertSafeFetchUrl rejects non-http(s) schemes and private/reserved hosts (SSRF guard),
	// subsuming the prior manual protocol check.
	const { url: scope } = await assertSafeFetchUrl(input.scopeUrl);

	const backend = input.browserBackend ?? DEFAULT_BROWSER_BACKEND;
	const effectiveProxy = resolveEnvProxyForUrl(input.scopeUrl);
	const { session } = await acquireSessionPage({
		options: {
			sessionId: input.sessionId,
			browserBackend: backend,
			proxy: input.proxy ?? effectiveProxy,
		},
		backend,
		safetyCheck: assertSafeFetchUrl,
		effectiveProxy: input.proxy ?? effectiveProxy,
		reusePage: true,
		browserLoader: deps.browserLoader,
	});

	// oxlint-disable-next-line typescript/no-explicit-any -- bridge Playwright Cookie type
	const rawCookies: any[] = await session.context.cookies([input.scopeUrl]);
	const scopeHost = scope.hostname.toLowerCase();
	const filtered = rawCookies.filter((cookie) => cookieDomainMatches(scopeHost, cookie.domain));

	const httpSession = await getOrCreateSession(targetSessionId);
	const domains = new Set<string>();
	for (const cookie of filtered) {
		const domain =
			(cookie.domain as string | undefined)?.toLowerCase().replace(/^\./u, "") ?? scopeHost;
		domains.add(domain);
		httpSession.cookies = httpSession.cookies.filter(
			(existing) =>
				!(
					existing.name === cookie.name &&
					(existing.domain ?? scopeHost) === domain &&
					(existing.path ?? "/") === (cookie.path ?? "/")
				),
		);
		httpSession.cookies.push({
			name: cookie.name,
			value: cookie.value,
			domain,
			hostOnly: !String(cookie.domain ?? "").startsWith("."),
			path: cookie.path ?? "/",
			expires:
				typeof cookie.expires === "number" && cookie.expires > 0
					? new Date(cookie.expires * 1000).toISOString()
					: undefined,
			httpOnly: cookie.httpOnly,
			secure: cookie.secure,
			sameSite: cookie.sameSite,
		});
	}
	httpSession.lastUsedAt = new Date().toISOString();
	await persistSession(httpSession);

	return {
		sourceSessionId: input.sessionId,
		targetSessionId,
		scopeUrl: input.scopeUrl,
		cookieCount: filtered.length,
		domains: [...domains],
	};
}

export async function browserScreenshot(
	input: BrowserScreenshotInput,
	signal?: AbortSignal,
	deps: BrowserActDeps = {},
): Promise<BrowserScreenshotResult> {
	const startedAt = Date.now();
	validateSessionId(input.sessionId);
	const backend = input.browserBackend ?? DEFAULT_BROWSER_BACKEND;
	const safetyCheck = assertSafeFetchUrl;
	const effectiveProxy = input.proxy ? resolveEnvProxyForUrl(input.proxy) : undefined;

	const { page } = await acquireSessionPage({
		options: {
			sessionId: input.sessionId,
			saveSession: input.saveSession,
			browserBackend: backend,
			proxy: effectiveProxy,
		},
		backend,
		safetyCheck,
		effectiveProxy,
		reusePage: true,
		browserLoader: deps.browserLoader,
	});

	if (signal?.aborted) throw new Error("Browser screenshot aborted");

	const fullPage = input.fullPage ?? false;
	const timeoutMs = (input.timeoutSeconds ?? 30) * 1_000;
	let pngBuffer: Buffer;
	if (input.selector) {
		pngBuffer = (await page.locator(selectorOf(input.selector)).screenshot({
			timeout: timeoutMs,
		})) as Buffer;
	} else {
		pngBuffer = (await page.screenshot({
			fullPage,
			timeout: timeoutMs,
		})) as Buffer;
	}

	const blob = await writeBlob(pngBuffer, "image/png");
	// PNG IHDR: width/height are big-endian u32 at byte offsets 16/20 (after the
	// 8-byte signature + 8-byte chunk header). page.screenshot always emits PNG.
	return {
		url: page.url(),
		backend,
		blobPath: blob.blobPath,
		byteLength: blob.byteLength,
		width: pngBuffer.readUInt32BE(16),
		height: pngBuffer.readUInt32BE(20),
		fullPage,
		selector: input.selector,
		durationMs: Date.now() - startedAt,
	};
}

/**
 * Runs caller-supplied JS in the live page via `page.evaluate`. Residual risks: can read
 * document.cookie/localStorage; runaway in-page loops are not killed by the timeout (Promise.race
 * only unblocks the tool). Network egress from evaluate is guarded by the context-level route
 * handler in playwright.ts.
 */
export async function browserEvaluate(
	input: BrowserEvaluateInput,
	signal?: AbortSignal,
	deps: BrowserActDeps = {},
): Promise<BrowserEvaluateResult> {
	const startedAt = Date.now();
	validateSessionId(input.sessionId);
	const backend = input.browserBackend ?? DEFAULT_BROWSER_BACKEND;
	const safetyCheck = assertSafeFetchUrl;
	const effectiveProxy = input.proxy ? resolveEnvProxyForUrl(input.proxy) : undefined;
	const timeoutMs = (input.timeoutSeconds ?? 30) * 1_000;

	const { page } = await acquireSessionPage({
		options: {
			sessionId: input.sessionId,
			saveSession: input.saveSession,
			browserBackend: backend,
			proxy: effectiveProxy,
		},
		backend,
		safetyCheck,
		effectiveProxy,
		reusePage: true,
		browserLoader: deps.browserLoader,
	});

	if (signal?.aborted) throw new Error("Browser evaluate aborted");

	let timer: ReturnType<typeof setTimeout> | undefined;
	let raw: unknown;
	try {
		raw = await Promise.race([
			page.evaluate(input.script),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`evaluate timed out after ${input.timeoutSeconds ?? 30}s`));
				}, timeoutMs);
			}),
		]);
	} finally {
		// Clear the timer so a fast evaluate doesn't leave a dangling timeout holding the event loop.
		clearTimeout(timer);
	}

	const full = raw === undefined ? "null" : JSON.stringify(raw);
	const CAP = 10_000;
	const truncated = full.length > CAP;
	const result = truncated ? `${full.slice(0, CAP)}…[truncated]` : full;

	return {
		url: page.url(),
		backend,
		result,
		truncated,
		durationMs: Date.now() - startedAt,
	};
}

function cookieDomainMatches(host: string, cookieDomain: string | undefined): boolean {
	if (!cookieDomain) return true;
	const normalized = cookieDomain.toLowerCase().replace(/^\./u, "");
	return host === normalized || host.endsWith(`.${normalized}`);
}

async function pierceShadowRoots(page: {
	evaluate: (fn: () => void) => Promise<void>;
}): Promise<void> {
	await page.evaluate(() => {
		const stack: Array<Document | ShadowRoot> = [document];
		while (stack.length > 0) {
			const root = stack.pop()!;
			const hosts = root.querySelectorAll("*");
			for (const host of hosts) {
				const shadow = (host as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
				if (shadow === null) continue;
				const wrapper = document.createElement("div");
				wrapper.className = "__shadow_content";
				wrapper.innerHTML = shadow.innerHTML;
				host.parentNode?.insertBefore(wrapper, host.nextSibling);
				stack.push(shadow);
			}
		}
	});
}

/** Inverse of pierceShadowRoots: remove injected wrappers from the light DOM and every shadow root. */
async function removeShadowContentWrappers(page: {
	evaluate: (fn: () => void) => Promise<void>;
}): Promise<void> {
	await page.evaluate(() => {
		const stack: Array<Document | ShadowRoot> = [document];
		while (stack.length > 0) {
			const root = stack.pop()!;
			for (const host of root.querySelectorAll("*")) {
				const shadow = (host as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
				if (shadow !== null) stack.push(shadow);
			}
			for (const wrapper of root.querySelectorAll(".__shadow_content")) wrapper.remove();
		}
	});
}
