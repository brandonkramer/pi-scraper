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
	validateSessionId,
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

export interface BrowserActionInput {
	action: "navigate" | "click" | "fill" | "select" | "snapshot";
	sessionId: string;
	url?: string;
	selector?: string;
	value?: string;
	timeoutSeconds?: number;
	browserBackend?: BrowserBackend;
	proxy?: string;
	saveSession?: boolean;
	// ponytail: locale/timezone/browserProfile bind at session-context CREATION only. session-pool
	// reuses an existing context and ignores these on reuse — use a new sessionId to change them.
	locale?: string;
	timezone?: string;
	browserProfile?: string;
	/**
	 * Snapshot detail. "interactive" (default) = flat interactive list; "outline" = orientation map
	 * (landmarks + role counts + headings, no refs); "full" = whole AI tree.
	 */
	detail?: "interactive" | "outline" | "full";
	/** CSS selector to limit the snapshot to one region (e.g. a form) instead of the whole page. */
	scope?: string;
	/** Narrow the interactive list to these roles, e.g. ["textbox","button"] for form-filling. */
	roles?: string[];
}

export interface BrowserActionResult {
	action: string;
	url: string;
	snapshot: string;
	/** HTTP status from the navigation response; navigate only (other actions have no response). */
	status?: number;
	/** Backend that ran the action: "cloak" | "playwright". */
	backend: BrowserBackend;
	/** Wall time for the whole action, ms. */
	durationMs: number;
}

export interface BrowserActDeps {
	browserLoader?: (backend: BrowserBackend, options: BrowserRenderOptions) => Promise<Browser>;
}

export interface BrowserPageFetchRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
}

export interface BrowserPageFetchResult {
	status: number;
	text: string;
	finalUrl: string;
	contentType?: string;
}

export interface BrowserFetchSession {
	/**
	 * Run fetch() inside the navigated page — carries the browser's cookies, fingerprint, and
	 * JS-challenge pass.
	 */
	pageFetch(req: BrowserPageFetchRequest, signal?: AbortSignal): Promise<BrowserPageFetchResult>;
	/** HTML + metadata captured from the initial navigation, for prerendered-page reuse. */
	rendered: BrowserRenderResult;
	/** Destroy the ephemeral session (closes context + browser). */
	close(): Promise<void>;
}

export interface OpenBrowserFetchSessionInput {
	url: string;
	sessionId: string;
	browserBackend?: BrowserBackend;
	proxy?: string;
	timeoutSeconds?: number;
}

/** Signature of {@link openBrowserFetchSession}, for dependency-injection overrides in tests. */
export type OpenBrowserFetchSession = typeof openBrowserFetchSession;

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

export interface AcquireSessionPageArgs {
	options: BrowserRenderOptions;
	backend: BrowserBackend;
	safetyCheck: BrowserSafetyCheck;
	effectiveProxy: string | undefined;
	reusePage?: boolean;
	browserLoader?: (backend: BrowserBackend, options: BrowserRenderOptions) => Promise<Browser>;
}

export async function acquireSessionPage({
	options,
	backend,
	safetyCheck,
	effectiveProxy,
	reusePage = false,
	browserLoader = defaultBrowserLoader,
}: AcquireSessionPageArgs): Promise<{
	page: Page;
	browser: Browser;
	guard: BrowserRouteGuard;
	session: BrowserSession;
}> {
	if (!options.sessionId) {
		throw new Error("acquireSessionPage requires sessionId");
	}

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
			reusePage,
		} as Parameters<typeof acquireBrowserSession>[1]);
		return {
			page: s.page as unknown as Page,
			browser: s.session.browser as unknown as Browser,
			guard: s.session.guard,
			session: s.session,
		};
	}

	const storageState = (await loadBrowserSessionStorageState(options.sessionId)) as
		| string
		| Record<string, unknown>
		| undefined;
	// oxlint-disable-next-line typescript/no-explicit-any -- bridge local Browser ↔ playwright core types
	const launchBrowser: any = () => browserLoader(backend, { ...options, proxy: effectiveProxy });
	const s = await acquireBrowserSession(options.sessionId, {
		launchBrowser,
		safetyCheck,
		profile: options.browserProfile,
		proxy: effectiveProxy,
		headers: options.headers,
		storageState: storageState ?? undefined,
		reusePage,
	});
	return {
		page: s.page as unknown as Page,
		browser: s.session.browser as unknown as Browser,
		guard: s.session.guard,
		session: s.session,
	};
}

export async function browserAct(
	input: BrowserActionInput,
	signal?: AbortSignal,
	deps: BrowserActDeps = {},
): Promise<BrowserActionResult> {
	const startedAt = Date.now();
	validateSessionId(input.sessionId);
	const backend = input.browserBackend ?? DEFAULT_BROWSER_BACKEND;
	const safetyCheck = assertSafeFetchUrl;
	const effectiveProxy = input.proxy ?? (input.url ? resolveEnvProxyForUrl(input.url) : undefined);
	const renderOptions: BrowserRenderOptions = {
		sessionId: input.sessionId,
		saveSession: input.saveSession,
		browserBackend: backend,
		proxy: effectiveProxy,
		// Bind at session-context creation; ignored on reuse of an existing sessionId (session-pool).
		locale: input.locale,
		timezone: input.timezone,
		browserProfile: input.browserProfile,
	};
	const browserLoader = deps.browserLoader ?? defaultBrowserLoader;

	const { page, guard } = await acquireSessionPage({
		options: renderOptions,
		backend,
		safetyCheck,
		effectiveProxy,
		reusePage: true,
		browserLoader,
	});
	const browserSafety: BrowserSafetyState = { check: safetyCheck, checkedHosts: new Map() };
	guard.setCheckedHostsForPage(page, browserSafety.checkedHosts);

	const timeout = (input.timeoutSeconds ?? 30) * 1_000;
	if (signal?.aborted) throw abortError(input.url ?? page.url());

	let status: number | undefined;
	switch (input.action) {
		case "navigate": {
			if (!input.url) throw new Error("navigate requires url");
			const safe = await assertSafeBrowserUrl(input.url, input.url, undefined, browserSafety);
			try {
				const response = await page.goto(safe.normalizedUrl, {
					waitUntil: "domcontentloaded",
					timeout,
				});
				status = response?.status();
			} catch (error) {
				throw guard.consumeError(page, safe.normalizedUrl) ?? error;
			}
			const finalUrl = page.url();
			await assertSafeBrowserUrl(finalUrl, safe.normalizedUrl, finalUrl, browserSafety);
			break;
		}
		case "click":
			await page.click(selectorOf(input.selector), { timeout });
			break;
		case "fill":
			await page.fill(selectorOf(input.selector), input.value ?? "", { timeout });
			break;
		case "select":
			await page.selectOption(selectorOf(input.selector), input.value ?? "");
			break;
		case "snapshot":
			break;
		default:
			throw new Error(`unknown action: ${String(input.action)}`);
	}

	// Surface any request the route guard blocked during this action (e.g. a click
	// that navigated to a private host). The fetch is already aborted; this turns the
	// silent block into a tool error instead of a misleading snapshot.
	const blocked = guard.consumeError(page, page.url());
	if (blocked) throw blocked;

	// NOTE: deliberately NOT closing the page. The pool owns its lifecycle.
	const tree = input.scope
		? await page.locator(input.scope).first().ariaSnapshot({ mode: "ai" })
		: await page.ariaSnapshot({ mode: "ai" });
	return {
		action: input.action,
		url: page.url(),
		snapshot: snapshotFor(input, tree),
		status,
		backend,
		durationMs: Date.now() - startedAt,
	};
}

interface InPageFetchPayload {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
	timeoutMs: number;
}

/**
 * Runs INSIDE the page via page.evaluate — uses the browser's own `fetch` so the request carries
 * the page's cookies + fingerprint + JS-challenge pass. Must stay self-contained (no closure
 * capture): Playwright serializes it to run in the browser context.
 */
async function inPageFetch(p: InPageFetchPayload): Promise<BrowserPageFetchResult> {
	const res = await fetch(p.url, {
		method: p.method,
		headers: p.headers,
		body: p.body,
		credentials: "include",
		signal: AbortSignal.timeout(p.timeoutMs),
	});
	return {
		status: res.status,
		text: await res.text(),
		finalUrl: res.url,
		contentType: res.headers.get("content-type") ?? undefined,
	};
}

/**
 * Open a pooled browser session, navigate to `url` (establishing cookies + JS-challenge pass on the
 * target origin), and expose a `pageFetch` that runs `fetch()` _inside_ that page. Same-origin API
 * calls (e.g. Reddit `.json`) then carry the browser's cookies + fingerprint and return 200 where a
 * plain HTTP client gets 403. The context route guard validates every in-page fetch host, so this
 * stays SSRF-safe. The caller MUST `close()` to destroy the ephemeral session.
 */
export async function openBrowserFetchSession(
	input: OpenBrowserFetchSessionInput,
	signal?: AbortSignal,
	deps: BrowserActDeps = {},
): Promise<BrowserFetchSession> {
	validateSessionId(input.sessionId);
	const backend = input.browserBackend ?? DEFAULT_BROWSER_BACKEND;
	const safetyCheck = assertSafeFetchUrl;
	const effectiveProxy = input.proxy ?? resolveEnvProxyForUrl(input.url);
	const browserLoader = deps.browserLoader ?? defaultBrowserLoader;

	const { page, guard, session } = await acquireSessionPage({
		options: { sessionId: input.sessionId, browserBackend: backend, proxy: effectiveProxy },
		backend,
		safetyCheck,
		effectiveProxy,
		reusePage: true,
		browserLoader,
	});
	const browserSafety: BrowserSafetyState = { check: safetyCheck, checkedHosts: new Map() };
	guard.setCheckedHostsForPage(page, browserSafety.checkedHosts);

	const navTimeout = (input.timeoutSeconds ?? 30) * 1_000;
	if (signal?.aborted) {
		await destroyBrowserSession(session.id);
		throw abortError(input.url);
	}
	const safe = await assertSafeBrowserUrl(input.url, input.url, undefined, browserSafety);
	let response: { status(): number } | null;
	try {
		response = await page.goto(safe.normalizedUrl, {
			waitUntil: "domcontentloaded",
			timeout: navTimeout,
		});
	} catch (error) {
		await destroyBrowserSession(session.id);
		throw guard.consumeError(page, safe.normalizedUrl) ?? error;
	}
	const blocked = guard.consumeError(page, safe.normalizedUrl);
	if (blocked) {
		await destroyBrowserSession(session.id);
		throw blocked;
	}
	const finalUrl = page.url();
	await assertSafeBrowserUrl(finalUrl, safe.normalizedUrl, finalUrl, browserSafety);
	// content() can race a client-side redirect/hydration. The rendered HTML is secondary for
	// API-fetch verticals (reddit/youtube use pageFetch, not fetchPage), so don't fail the session.
	const html = await page.content().catch(() => "");
	const rendered: BrowserRenderResult = {
		url: safe.normalizedUrl,
		finalUrl,
		status: response?.status(),
		html,
	};

	return {
		rendered,
		pageFetch: async (req, reqSignal) => {
			if (reqSignal?.aborted || signal?.aborted) throw abortError(req.url);
			// In-page fetch. The context route guard (set above) validates the request host → SSRF-safe.
			const payload: InPageFetchPayload = {
				url: req.url,
				method: req.method ?? "GET",
				headers: req.headers ?? {},
				body: req.body,
				timeoutMs: req.timeoutMs ?? navTimeout,
			};
			return await page.evaluate(
				inPageFetch as unknown as () => Promise<BrowserPageFetchResult>,
				payload,
			);
		},
		close: async () => {
			await destroyBrowserSession(session.id);
		},
	};
}

export function selectorOf(selector: string | undefined): string {
	if (!selector) throw new Error("selector required");
	// `@eN` targets an element ref from a prior ariaSnapshot({ mode: "ai" }) via
	// Playwright's aria-ref selector engine. Anything else is a plain CSS selector.
	return selector.startsWith("@") ? `aria-ref=${selector.slice(1)}` : selector;
}

// Roles worth handing the model for *driving* a page (plus heading for orientation).
const INTERACTIVE =
	/^(link|button|textbox|searchbox|combobox|checkbox|radio|switch|slider|spinbutton|menuitem|menuitemcheckbox|menuitemradio|tab|option|listbox|treeitem|heading)\b/;

// Container/landmark roles, for the orientation outline.
const LANDMARK = /^(banner|navigation|main|contentinfo|complementary|search|form|region)\b/;

// Cap on interactive elements in one snapshot — bounds token cost on link-heavy pages (a news
// homepage emits hundreds of links). Overflow is summarised, not dumped.
const MAX_INTERACTIVE = 150;
const OUTLINE_HEADINGS = 25;

/** Drop query + fragment (trackers, session ids); the model drives by @eN ref, not the href. */
function trimUrl(url: string): string {
	const cut = url.search(/[?#]/);
	return cut >= 0 ? url.slice(0, cut) : url;
}

/**
 * Flatten the AI-mode ARIA YAML to a deduped, capped, interactive-only list. Output-only and
 * ref-safe: `aria-ref=eN` resolves against the ref map Playwright builds during the ariaSnapshot
 * call, not against the string we trim. Drops nesting (the ref targets, the name disambiguates) and
 * `[cursor=pointer]` noise; trims a link's `/url:` child to origin+path. `roles`, when set, narrows
 * to that subset (e.g. ["textbox","button"] for form-filling).
 */
export function interactiveSnapshot(snapshot: string, roles?: string[]): string {
	const allow = roles && roles.length > 0 ? new Set(roles) : undefined;
	const lines = snapshot.split("\n");
	const seen = new Set<string>();
	const unique: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = /^\s*-\s+(.*)$/.exec(lines[i]);
		if (!m) continue;
		const content = m[1].replace(/:\s*$/, "").replaceAll(" [cursor=pointer]", "");
		if (!INTERACTIVE.test(content)) continue;
		if (allow && !allow.has(/^\S+/.exec(content)?.[0] ?? "")) continue;
		const url = /^\s*-\s*\/url:\s*(.*)$/.exec(lines[i + 1] ?? "");
		const line = content + (url ? ` ${trimUrl(url[1].trim())}` : "");
		// Dedupe by content (e.g. a nav link repeated in the footer); keep the first ref.
		const key = line.replace(/\s*\[ref=[^\]]+\]/, "");
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(line);
	}
	const shown = unique.slice(0, MAX_INTERACTIVE);
	if (unique.length > shown.length) {
		shown.push(`… +${unique.length - shown.length} more (scope=<css> or roles=[…] to narrow)`);
	}
	return shown.join("\n");
}

/**
 * Cheap orientation map of a page: landmark roles present, interactive-role counts, and the top
 * headings — so the model knows what to drive without ingesting every link. Mirrors read's `map`.
 */
export function outlineSnapshot(snapshot: string): string {
	const counts = new Map<string, number>();
	const landmarks = new Set<string>();
	const headings: string[] = [];
	for (const raw of snapshot.split("\n")) {
		const m = /^\s*-\s+(.*)$/.exec(raw);
		if (!m) continue;
		const content = m[1].replace(/:\s*$/, "").replaceAll(" [cursor=pointer]", "");
		const role = /^\S+/.exec(content)?.[0] ?? "";
		if (LANDMARK.test(role)) landmarks.add(role);
		if (role === "heading") {
			const name = /"([^"]*)"/.exec(content)?.[1];
			const level = Number(/\[level=(\d+)\]/.exec(content)?.[1] ?? "1");
			if (name && headings.length < OUTLINE_HEADINGS) {
				headings.push(`${"  ".repeat(Math.min(level - 1, 3))}${"#".repeat(level)} ${name}`);
			}
		} else if (INTERACTIVE.test(content)) {
			counts.set(role, (counts.get(role) ?? 0) + 1);
		}
	}
	const out: string[] = [];
	if (landmarks.size > 0) out.push(`landmarks: ${[...landmarks].join(", ")}`);
	const roleSummary = [...counts.entries()]
		.toSorted((a, b) => b[1] - a[1])
		.map(([role, n]) => `${role} ${n}`)
		.join(" · ");
	if (roleSummary) out.push(roleSummary);
	if (headings.length > 0) out.push("outline:", ...headings);
	out.push('→ scope=<css> or roles=[…] for interactive refs · detail:"full" for the raw tree');
	return out.join("\n");
}

function snapshotFor(input: BrowserActionInput, full: string): string {
	if (input.detail === "full") return full;
	if (input.detail === "outline") return outlineSnapshot(full);
	return interactiveSnapshot(full, input.roles);
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
			const acquired = await acquireSessionPage({
				options,
				backend,
				safetyCheck,
				effectiveProxy,
				reusePage: false,
				browserLoader,
			});
			page = acquired.page;
			browser = acquired.browser;
			guard = acquired.guard;
			session = acquired.session;
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
