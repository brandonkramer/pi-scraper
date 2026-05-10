/**
 * @fileoverview browser playwright module.
 */
import { applyStealthPatches } from "./stealth.ts";
import {
	acquireBrowserSession,
	destroyBrowserSession,
	releaseBrowserSession,
} from "./session-pool.ts";
import { createAbortError } from "../http/abort.ts";
import {
	assertSafeFetchUrl,
	assertSafeUrl,
	type SafeUrlResult,
	UrlSafetyError,
} from "../http/url-safety.ts";
import type { StructuredError } from "../types.ts";

export interface BrowserRenderOptions {
	timeoutSeconds?: number;
	headers?: Record<string, string>;
	cookies?: Record<string, string>;
	proxy?: string;
	browserProfile?: string;
	waitUntil?: "domcontentloaded" | "load" | "networkidle";

	// Session + stealth support
	sessionId?: string;
	saveSession?: boolean;
	clearSession?: boolean;
	stealth?: boolean;
	autoWait?: boolean;
	blockResources?: string[];
	blockAds?: boolean;
	hideCanvas?: boolean;
	blockWebRTC?: boolean;
	locale?: string;
	timezone?: string;
}

export interface BrowserRenderResult {
	url: string;
	finalUrl: string;
	status?: number;
	html: string;
}

export interface BrowserRenderer {
	fetchRendered(
		url: string | URL,
		options?: BrowserRenderOptions,
		signal?: AbortSignal,
	): Promise<BrowserRenderResult>;
}

export class BrowserRenderError extends Error {
	readonly structured: StructuredError;

	constructor(structured: StructuredError) {
		super(structured.message);
		this.name = "BrowserRenderError";
		this.structured = structured;
	}
}

export interface PlaywrightRendererFactoryOptions {
	loader?: () => Promise<PlaywrightModule>;
	safetyCheck?: BrowserSafetyCheck;
}

export function createPlaywrightRenderer(
	factoryOptions: PlaywrightRendererFactoryOptions = {},
): BrowserRenderer {
	return {
		fetchRendered: (input, options, signal) =>
			renderWithLoader(
				input,
				options,
				signal,
				factoryOptions.loader ?? defaultPlaywrightLoader,
				factoryOptions.safetyCheck ?? assertSafeFetchUrl,
			),
	};
}

export async function fetchRendered(
	input: string | URL,
	options: BrowserRenderOptions = {},
	signal?: AbortSignal,
): Promise<BrowserRenderResult> {
	return renderWithLoader(input, options, signal, defaultPlaywrightLoader);
}

async function renderWithLoader(
	input: string | URL,
	options: BrowserRenderOptions = {},
	signal: AbortSignal | undefined,
	loader: () => Promise<PlaywrightModule>,
	safetyCheck: BrowserSafetyCheck = assertSafeFetchUrl,
): Promise<BrowserRenderResult> {
	const browserSafety: BrowserSafetyState = {
		check: safetyCheck,
		checkedHosts: new Map(),
	};
	const safe = await assertSafeBrowserUrl(
		input,
		input.toString(),
		undefined,
		browserSafety,
	);
	const url = safe.normalizedUrl;
	if (signal?.aborted) throw abortError(url);

	const playwright = await loadPlaywright(url, loader);
	let browser: any;
	let abortListener: (() => void) | undefined;
	let page: any;
	let session: { id: string } | undefined;

	try {
		// 1) Acquire page: pooled session or fresh browser
		if (options.sessionId) {
			const s = await acquireBrowserSession(options.sessionId, {
				launchBrowser: () =>
					playwright.chromium
						.launch({
							headless: true,
							proxy: options.proxy ? { server: options.proxy } : undefined,
						})
						.then((b) => b as any),
				profile: options.browserProfile,
				proxy: options.proxy,
				headers: options.headers,
			});
			page = s.page;
			browser = s.session.browser;
			session = s.session;
		} else {
			browser = await playwright.chromium.launch({
				headless: true,
				proxy: options.proxy ? { server: options.proxy } : undefined,
			});
			const context = await browser.newContext({
				extraHTTPHeaders: options.headers,
				serviceWorkers: "block",
				userAgent: options.browserProfile,
			});
			if (options.cookies) {
				await context.addCookies(
					Object.entries(options.cookies).map(([name, value]) => ({
						name,
						value,
						url,
					})),
				);
			}
			page = await context.newPage();
		}

		// 2) Apply stealth patches before navigation
		if (options.stealth) {
			await applyStealthPatches(page, {
				webdriver: true,
				canvasNoise: options.hideCanvas ?? false,
				blockWebRTC: options.blockWebRTC ?? false,
				locale: options.locale,
				timezone: options.timezone,
			});
		}

		// 3) Route for blocking + safety checks
		let blockedRequest: BrowserRenderError | undefined;
		if (!options.sessionId) {
			await page.context().route("**/*", async (route: any) => {
				const requestUrl = route.request().url();
				const routePolicy = browserRoutePolicy(requestUrl);
				if (routePolicy.action === "allow") {
					await route.continue();
					return;
				}
				if (routePolicy.action === "block") {
					blockedRequest ??= blockedRequestError(
						routePolicy.cause,
						url,
						requestUrl,
					);
					await route.abort("blockedbyclient").catch(() => undefined);
					return;
				}
				try {
					await assertSafeBrowserUrl(
						requestUrl,
						url,
						requestUrl,
						browserSafety,
					);
				} catch (error) {
					if (error instanceof BrowserRenderError) {
						blockedRequest ??= error;
						await route.abort("blockedbyclient").catch(() => undefined);
						return;
					}
					await route.continue();
					return;
				}
				await route.continue();
			});
		}

		const closeOnAbort = () => void page.close().catch(() => undefined);
		abortListener = closeOnAbort;
		signal?.addEventListener("abort", closeOnAbort, { once: true });

		let response: { status(): number } | null;
		try {
			response = await page.goto(url, {
				waitUntil: options.waitUntil ?? "domcontentloaded",
				timeout: (options.timeoutSeconds ?? 20) * 1_000,
			});
		} catch (error) {
			throw blockedRequest ?? error;
		}
		if (blockedRequest) throw blockedRequest;
		if (signal?.aborted) throw abortError(url);

		// 4) Auto-wait for challenge pages
		if (options.autoWait) {
			await autoWaitForChallenge(page, url, options.timeoutSeconds ?? 20);
		}

		const finalUrl = page.url();
		await assertSafeBrowserUrl(finalUrl, url, finalUrl, browserSafety);
		return {
			url,
			finalUrl,
			status: response?.status(),
			html: await page.content(),
		};
	} finally {
		if (abortListener) signal?.removeEventListener("abort", abortListener);
		if (session) {
			releaseBrowserSession(session.id);
			if (options.clearSession) {
				await destroyBrowserSession(session.id);
			}
		} else if (browser) {
			await browser.close().catch(() => undefined);
		}
	}
}

async function loadPlaywright(
	url: string,
	loader: () => Promise<PlaywrightModule>,
): Promise<PlaywrightModule> {
	try {
		return await loader();
	} catch (cause) {
		throw new BrowserRenderError({
			code: "BROWSER_UNAVAILABLE",
			phase: "browser",
			message:
				"Playwright is not installed or Chromium browser binaries are unavailable. Playwright is an optional dependency; if it was omitted, run `npm install playwright` in the extension directory, then `npx playwright install chromium`.",
			retryable: false,
			url,
			cause,
		});
	}
}

type BrowserSafetyCheck = (input: string | URL) => Promise<SafeUrlResult>;

interface BrowserSafetyState {
	check: BrowserSafetyCheck;
	checkedHosts: Map<string, Promise<SafeUrlResult>>;
}

async function assertSafeBrowserUrl(
	input: string | URL,
	url: string,
	finalUrl?: string,
	state?: BrowserSafetyState,
): Promise<SafeUrlResult> {
	try {
		if (!state) return await assertSafeFetchUrl(input);
		const safe = assertSafeUrl(input);
		const hostKey = safe.url.hostname.toLowerCase();
		let hostCheck = state.checkedHosts.get(hostKey);
		if (!hostCheck) {
			hostCheck = state.check(safe.normalizedUrl);
			state.checkedHosts.set(hostKey, hostCheck);
		}
		await hostCheck;
		return safe;
	} catch (cause) {
		if (cause instanceof UrlSafetyError || cause instanceof TypeError) {
			throw blockedRequestError(cause, url, finalUrl ?? input.toString());
		}
		throw cause;
	}
}

function browserRoutePolicy(
	rawUrl: string,
):
	| { action: "validate" }
	| { action: "allow" }
	| { action: "block"; cause: unknown } {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch (cause) {
		return { action: "block", cause };
	}
	const protocol = parsed.protocol.toLowerCase();
	if (protocol === "http:" || protocol === "https:")
		return { action: "validate" };
	if (protocol === "file:") {
		return {
			action: "block",
			cause: new UrlSafetyError(
				"BROWSER_BLOCKED_FILE_URL",
				`Blocked browser request to local file URL: ${rawUrl}`,
				rawUrl,
			),
		};
	}
	if (isBenignBrowserScheme(protocol)) return { action: "allow" };
	return {
		action: "block",
		cause: new UrlSafetyError(
			"UNSUPPORTED_URL_SCHEME",
			`Blocked browser request to unsupported URL scheme: ${protocol}`,
			rawUrl,
		),
	};
}

function isBenignBrowserScheme(protocol: string): boolean {
	return (
		protocol === "about:" ||
		protocol === "blob:" ||
		protocol === "chrome-extension:" ||
		protocol === "data:" ||
		protocol === "devtools:"
	);
}

function blockedRequestError(
	cause: unknown,
	url: string,
	finalUrl: string,
): BrowserRenderError {
	const causeMessage =
		cause instanceof Error ? cause.message : "URL failed safety checks";
	return new BrowserRenderError({
		code: "BROWSER_BLOCKED_PRIVATE_URL",
		phase: "browser",
		message: `Blocked browser request to unsafe URL: ${finalUrl}. ${causeMessage}`,
		retryable: false,
		url,
		finalUrl,
		cause,
	});
}

function abortError(url: string): BrowserRenderError {
	const cause = createAbortError("Browser rendering aborted");
	return new BrowserRenderError({
		code: "ABORTED",
		phase: "browser",
		message: cause.message,
		retryable: false,
		url,
		cause,
	});
}

async function autoWaitForChallenge(
	page: Page,
	url: string,
	timeoutSeconds: number,
): Promise<void> {
	const challengeMarkers = [
		"Just a moment...",
		"Checking your browser...",
		"Please wait...",
	];
	const maxWaitMs = timeoutSeconds * 1_000;
	const pollInterval = 1_000;
	const start = Date.now();

	while (Date.now() - start < maxWaitMs) {
		const title = await page.title().catch(() => "");
		const body = await page.content().catch(() => "");
		const isChallenge = challengeMarkers.some(
			(m) => title.includes(m) || body.includes(m),
		);
		if (!isChallenge) return;
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}
	// Timeout exceeded — challenge still present
	throw new BrowserRenderError({
		code: "BLOCKED_CHALLENGE",
		phase: "browser",
		message:
			'Challenge page persisted after auto-wait timeout. Try mode: "fingerprint" or a different browser profile.',
		retryable: false,
		url,
		recommendedMode: "fingerprint",
	});
}

async function defaultPlaywrightLoader(): Promise<PlaywrightModule> {
	const moduleName = "playwright";
	return (await import(moduleName)) as PlaywrightModule;
}

export interface PlaywrightModule {
	chromium: {
		launch(options: Record<string, unknown>): Promise<Browser>;
	};
}

interface Browser {
	newContext(options: Record<string, unknown>): Promise<BrowserContext>;
	close(): Promise<void>;
}

interface BrowserContext {
	addCookies(cookies: Array<Record<string, string>>): Promise<void>;
	newPage(): Promise<Page>;
	route(glob: string, handler: (route: Route) => Promise<void>): Promise<void>;
}

interface Route {
	abort(errorCode?: string): Promise<void>;
	continue(): Promise<void>;
	request(): Request;
}

interface Request {
	url(): string;
}

interface Page {
	goto(
		url: string,
		options: Record<string, unknown>,
	): Promise<{ status(): number } | null>;
	content(): Promise<string>;
	title(): Promise<string>;
	url(): string;
	close(): Promise<void>;
	context(): BrowserContext;
}
