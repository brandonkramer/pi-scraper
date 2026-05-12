import { createAbortError } from "../http/abort.ts";
import { assertSafeFetchUrl } from "../http/url-safety.ts";
import {
	assertSafeBrowserUrl,
	BrowserRenderError,
	createBrowserRouteGuard,
	type BrowserRouteGuard,
	type BrowserSafetyCheck,
	type BrowserContext,
	type BrowserSafetyState,
	type Page,
} from "./route-guard.ts";
import {
	acquireBrowserSession,
	destroyBrowserSession,
	releaseBrowserSession,
} from "./session-pool.ts";
/** @file Browser playwright module. */
import { applyStealthPatches } from "./stealth.ts";

export { BrowserRenderError } from "./route-guard.ts";

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
	return await renderWithLoader(input, options, signal, defaultPlaywrightLoader);
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
	const safe = await assertSafeBrowserUrl(input, input.toString(), undefined, browserSafety);
	const url = safe.normalizedUrl;
	if (signal?.aborted) throw abortError(url);

	const playwright = await loadPlaywright(url, loader);
	let browser: Browser | undefined;
	let abortListener: (() => void) | undefined;
	let page: Page | undefined;
	let guard: BrowserRouteGuard | undefined;
	let session: { id: string } | undefined;

	try {
		// 1) Acquire page: pooled session or fresh browser
		if (options.sessionId) {
			const launchBrowser: Parameters<typeof acquireBrowserSession>[1]["launchBrowser"] = () =>
				playwright.chromium
					.launch({
						headless: true,
						proxy: options.proxy ? { server: options.proxy } : undefined,
					})
					.then((b: unknown) => b) as ReturnType<
					Parameters<typeof acquireBrowserSession>[1]["launchBrowser"]
				>;
			const s = await acquireBrowserSession(options.sessionId, {
				launchBrowser,
				safetyCheck,
				profile: options.browserProfile,
				proxy: options.proxy,
				headers: options.headers,
			});
			page = s.page as unknown as Page;
			browser = s.session.browser as unknown as Browser;
			guard = s.session.guard;
			session = s.session;
		} else {
			browser = (await playwright.chromium.launch({
				headless: true,
				proxy: options.proxy ? { server: options.proxy } : undefined,
			})) as unknown as Browser;
			const context = await browser.newContext({
				extraHTTPHeaders: options.headers,
				serviceWorkers: "block",
				userAgent: options.browserProfile,
			});
			guard = createBrowserRouteGuard(safetyCheck, browserSafety.checkedHosts);
			// oxlint-disable-next-line typescript/no-explicit-any -- bridge between route-guard.ts minimal Route and Playwright's full Route type
			await context.route("**/*", guard.handler as (route: any) => Promise<void>);
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
			await applyStealthPatches(page as unknown as Parameters<typeof applyStealthPatches>[0], {
				webdriver: true,
				canvasNoise: options.hideCanvas ?? false,
				blockWebRTC: options.blockWebRTC ?? false,
				locale: options.locale,
				timezone: options.timezone,
			});
		}

		const closeOnAbort = () =>
			void page?.close().catch(() => {
				/* no-op */
			});
		abortListener = closeOnAbort;
		signal?.addEventListener("abort", closeOnAbort, { once: true });

		let response: { status(): number } | null;
		try {
			response = await page.goto(url, {
				waitUntil: options.waitUntil ?? "domcontentloaded",
				timeout: (options.timeoutSeconds ?? 20) * 1_000,
			});
		} catch (error) {
			throw guard.consumeError(page, url) ?? error;
		}
		const blocked = guard.consumeError(page, url);
		if (blocked) throw blocked;
		if (signal?.aborted) throw abortError(url);

		// 3) Auto-wait for challenge pages
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
			await browser.close().catch(() => {
				/* no-op */
			});
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
	const challengeMarkers = ["Just a moment...", "Checking your browser...", "Please wait..."];
	const maxWaitMs = timeoutSeconds * 1_000;
	const pollInterval = 1_000;
	const start = Date.now();

	while (Date.now() - start < maxWaitMs) {
		const title = await page.title().catch(() => "");
		const body = await page.content().catch(() => "");
		const isChallenge = challengeMarkers.some((m) => title.includes(m) || body.includes(m));
		if (!isChallenge) return;
		await new Promise((resolve) => {
			setTimeout(resolve, pollInterval);
		});
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
