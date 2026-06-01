/** @file Browser module — CloakBrowser is the default backend for mode:"browser". */

import { DEFAULT_BROWSER_BACKEND } from "../defaults.ts";
import { createAbortError } from "../http/abort.ts";
import { resolveEnvProxyForUrl } from "../http/proxy-config.ts";
import { assertSafeFetchUrl } from "../http/url-safety.ts";
import type { BrowserBackend, OutputFormat } from "../types.ts";
import {
	assertSafeBrowserUrl,
	BrowserRenderError,
	createBrowserRouteGuard,
	type BrowserContext,
	type BrowserRouteGuard,
	type BrowserSafetyCheck,
	type BrowserSafetyState,
	type Page,
} from "./route-guard.ts";
import {
	acquireBrowserSession,
	destroyBrowserSession,
	releaseBrowserSession,
	type BrowserSession,
} from "./session-pool.ts";
import {
	deleteBrowserSessionStorageState,
	deleteCloakSessionProfile,
	loadBrowserSessionStorageState,
	resolveCloakSessionProfilePath,
	saveBrowserSessionStorageState,
} from "./session.ts";
import { applyStealthPatches } from "./stealth.ts";

export { BrowserRenderError } from "./route-guard.ts";
export type { BrowserBackend };

/** Minimal Browser interface — compatible with both playwright-core and cloakbrowser Browser types. */
export interface Browser {
	newContext(options: Record<string, unknown>): Promise<BrowserContext>;
	close(): Promise<void>;
}

export interface BrowserRenderOptions {
	timeoutSeconds?: number;
	headers?: Record<string, string>;
	cookies?: Record<string, string>;
	proxy?: string;
	browserProfile?: string;
	waitUntil?: "domcontentloaded" | "load" | "networkidle";

	// Backend selection
	/** @default "cloak" */
	browserBackend?: BrowserBackend;

	// Output format (used to decide whether to capture accessibility tree)
	format?: OutputFormat;

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
	/** Playwright accessibility snapshot when format="ax-tree" was requested. */
	axTree?: unknown;
}

export interface BrowserRenderer {
	fetchRendered(
		url: string | URL,
		options?: BrowserRenderOptions,
		signal?: AbortSignal,
	): Promise<BrowserRenderResult>;
}

export interface PlaywrightRendererFactoryOptions {
	safetyCheck?: BrowserSafetyCheck;
	/** @default "cloak" */
	browserBackend?: BrowserBackend;
	browserLoader?: (backend: BrowserBackend, options: BrowserRenderOptions) => Promise<Browser>;
}

export function createPlaywrightRenderer(
	factoryOptions: PlaywrightRendererFactoryOptions = {},
): BrowserRenderer {
	const loader = factoryOptions.browserLoader ?? defaultBrowserLoader;
	return {
		fetchRendered: (input, options, signal) =>
			renderWithLoader(
				input,
				{ ...options, browserBackend: options?.browserBackend ?? factoryOptions.browserBackend },
				signal,
				loader,
				factoryOptions.safetyCheck ?? assertSafeFetchUrl,
			),
	};
}

async function defaultBrowserLoader(
	backend: BrowserBackend,
	options: BrowserRenderOptions,
): Promise<Browser> {
	return await launchBrowserBackend(backend, options);
}

export async function fetchRendered(
	input: string | URL,
	options: BrowserRenderOptions = {},
	signal?: AbortSignal,
): Promise<BrowserRenderResult> {
	return await renderWithLoader(input, options, signal, defaultBrowserLoader);
}

async function renderWithLoader(
	input: string | URL,
	options: BrowserRenderOptions = {},
	signal: AbortSignal | undefined,
	browserLoader: (backend: BrowserBackend, options: BrowserRenderOptions) => Promise<Browser>,
	safetyCheck: BrowserSafetyCheck = assertSafeFetchUrl,
): Promise<BrowserRenderResult> {
	const browserSafety: BrowserSafetyState = {
		check: safetyCheck,
		checkedHosts: new Map(),
	};
	const safe = await assertSafeBrowserUrl(input, input.toString(), undefined, browserSafety);
	const url = safe.normalizedUrl;
	if (signal?.aborted) throw abortError(url);

	const effectiveProxy = options.proxy ?? resolveEnvProxyForUrl(url);
	const backend = options.browserBackend ?? DEFAULT_BROWSER_BACKEND;
	let browser: Browser | undefined;
	let abortListener: (() => void) | undefined;
	let page: Page | undefined;
	let guard: BrowserRouteGuard | undefined;
	let session: BrowserSession | undefined;

	try {
		// 1) Acquire page: pooled session or fresh browser
		if (options.sessionId) {
			const isCloakPersistent = backend === "cloak" && options.saveSession;

			if (isCloakPersistent) {
				// Cloak persistent context: cookies/localStorage survive across Pi restarts
				const launchContext = async () => {
					const cloak = await import("cloakbrowser");
					const userDataDir = resolveCloakSessionProfilePath(options.sessionId!);
					// oxlint-disable-next-line typescript/no-explicit-any -- bridge playwright-core ↔ playwright types
					const pwContext: any = await cloak.launchPersistentContext({
						userDataDir,
						headless: true,
						proxy: effectiveProxy,
						timezone: options.timezone,
						locale: options.locale,
					});
					// launchPersistentContext manages the browser internally;
					// closing the context persists the profile and closes the browser.
					// oxlint-disable-next-line typescript/no-explicit-any -- bridge local Browser ↔ cloakbrowser types
					const cloakBrowser: unknown = {
						close: async () => {
							await pwContext.close();
						},
					};
					return { browser: cloakBrowser, context: pwContext };
				};
				const s = await acquireBrowserSession(options.sessionId, {
					launchContext,
					safetyCheck,
					profile: options.browserProfile,
					proxy: effectiveProxy,
				} as Parameters<typeof acquireBrowserSession>[1]);
				page = s.page as unknown as Page;
				browser = s.session.browser as unknown as Browser;
				guard = s.session.guard;
				session = s.session;
			} else {
				const storageState = (await loadBrowserSessionStorageState(options.sessionId)) as
					| string
					| Record<string, unknown>
					| undefined;
				// oxlint-disable-next-line typescript/no-explicit-any -- bridge local Browser ↔ playwright core types
				const launchBrowser: any = () =>
					browserLoader(backend, { ...options, proxy: effectiveProxy });
				const s = await acquireBrowserSession(options.sessionId, {
					launchBrowser,
					safetyCheck,
					profile: options.browserProfile,
					proxy: effectiveProxy,
					headers: options.headers,
					storageState: storageState ?? undefined,
				});
				page = s.page as unknown as Page;
				browser = s.session.browser as unknown as Browser;
				guard = s.session.guard;
				session = s.session;
			}
		} else {
			browser = (await browserLoader(backend, {
				...options,
				proxy: effectiveProxy,
			})) as unknown as Browser;
			const context = await browser.newContext({
				extraHTTPHeaders: options.headers,
				serviceWorkers: "block",
				userAgent: options.browserProfile,
			});
			guard = createBrowserRouteGuard(safetyCheck);
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
		guard.setCheckedHostsForPage(page, browserSafety.checkedHosts);

		// 2) Apply JS-level stealth patches before navigation.
		//    CloakBrowser patches everything at the C++ level, so JS patches are
		//    redundant and would send detectable CDP traffic (page.evaluate).
		if (options.stealth && backend !== "cloak") {
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

		/* Pierce shadow roots so downstream parsers (linkedom) can read the content */
		await pierceShadowRoots(page);

		const result: BrowserRenderResult = {
			url,
			finalUrl,
			status: response?.status(),
			html: await page.content(),
		};
		if (options.format === "ax-tree") {
			result.axTree = await page.ariaSnapshot();
		}
		return result;
	} finally {
		if (abortListener) signal?.removeEventListener("abort", abortListener);
		if (page && session) {
			await page.close().catch(() => {
				/* no-op */
			});
		}
		if (session) {
			if (options.saveSession) {
				const state = await session.context.storageState().catch(() => null);
				if (state) {
					await saveBrowserSessionStorageState(session.id, state);
				}
			}
			releaseBrowserSession(session.id);
			if (options.clearSession) {
				await destroyBrowserSession(session.id);
				await deleteBrowserSessionStorageState(session.id);
				await deleteCloakSessionProfile(session.id);
			}
		} else if (browser) {
			await browser.close().catch(() => {
				/* no-op */
			});
		}
	}
}

/** Launch a browser using the selected backend. */
async function launchBrowserBackend(
	backend: BrowserBackend,
	options: BrowserRenderOptions,
): Promise<Browser> {
	if (backend === "cloak") {
		return await launchCloakBrowser(options);
	}
	return await launchPlaywrightBackend(options);
}

/** Launch via CloakBrowser — patched Chromium binary, stealth at C++ level. */
async function launchCloakBrowser(options: BrowserRenderOptions): Promise<Browser> {
	try {
		const cloak = await import("cloakbrowser");
		const browser = await cloak.launch({
			headless: true,
			proxy: options.proxy,
			timezone: options.timezone,
			locale: options.locale,
		});
		return browser as unknown as Browser;
	} catch (cause) {
		throw new BrowserRenderError({
			code: "BROWSER_UNAVAILABLE",
			phase: "browser",
			message:
				"CloakBrowser backend is not available. Install cloakbrowser and playwright-core, or use browserBackend: 'playwright'.",
			retryable: false,
			cause,
		});
	}
}

/** Launch via plain Playwright — stock Chromium browser. */
async function launchPlaywrightBackend(options: BrowserRenderOptions): Promise<Browser> {
	try {
		const { chromium } = await import("playwright");
		return (await chromium.launch({
			headless: true,
			proxy: options.proxy ? { server: options.proxy } : undefined,
		})) as unknown as Browser;
	} catch (cause) {
		throw new BrowserRenderError({
			code: "BROWSER_UNAVAILABLE",
			phase: "browser",
			message:
				"Playwright is not installed. Playwright is an optional dependency; run `npm install playwright` and `npx playwright install chromium`.",
			retryable: false,
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
/**
 * Pierce Shadow DOM roots so `page.content()` serializes shadow content as regular HTML that
 * downstream parsers (linkedom) can read. Injects a `<div class="__shadow_content">` sibling after
 * each host element containing the flattened shadow root HTML. Non-destructive — the page DOM and
 * shadow roots are unchanged; only the serialized output is augmented.
 */
async function pierceShadowRoots(page: Page): Promise<void> {
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
