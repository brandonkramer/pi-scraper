/**
 * @fileoverview browser playwright module.
 */
import {
	assertSafeFetchUrl,
	assertSafeUrl,
	type SafeUrlResult,
	UrlSafetyError,
} from "../http/url-safety.js";
import type { StructuredError } from "../types.js";

export interface BrowserRenderOptions {
	timeoutSeconds?: number;
	headers?: Record<string, string>;
	cookies?: Record<string, string>;
	proxy?: string;
	browserProfile?: string;
	waitUntil?: "domcontentloaded" | "load" | "networkidle";
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
	const browser = await playwright.chromium.launch({
		headless: true,
		proxy: options.proxy ? { server: options.proxy } : undefined,
	});
	let abortListener: (() => void) | undefined;
	try {
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
		let blockedRequest: BrowserRenderError | undefined;
		// Playwright owns Chromium's DNS/connect path, so browser mode cannot reuse
		// the Undici guarded dispatcher. Routing is the earliest Playwright hook we
		// have for validating navigation redirects and subresource URLs before the
		// browser is allowed to continue each request.
		await context.route("**/*", async (route) => {
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
				await assertSafeBrowserUrl(requestUrl, url, requestUrl, browserSafety);
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

		const page = await context.newPage();
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
		await browser.close().catch(() => undefined);
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
		if (isUrlSafetyBlock(cause)) {
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

function isUrlSafetyBlock(error: unknown): boolean {
	return error instanceof UrlSafetyError || error instanceof TypeError;
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
	return new BrowserRenderError({
		code: "ABORTED",
		phase: "browser",
		message: "Browser rendering aborted",
		retryable: false,
		url,
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
	url(): string;
	close(): Promise<void>;
}
