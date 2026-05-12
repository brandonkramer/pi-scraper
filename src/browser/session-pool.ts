/**
 * @remarks
 *   Maintains a pool of persistent Playwright browser + context instances keyed by sessionId.
 *   Sessions carry cookies, localStorage, and sessionStorage across multiple page navigations. Pool
 *   has max size + LRU eviction to prevent leaks.
 * @file Browser session pool for Playwright context reuse.
 */
import type { Browser, BrowserContext, Page } from "playwright";

import { createBrowserRouteGuard } from "./route-guard.ts";
import type { BrowserRouteGuard, BrowserSafetyCheck } from "./route-guard.ts";

export interface BrowserSession {
	id: string;
	browser: Browser;
	context: BrowserContext;
	guard: BrowserRouteGuard;
	lastUsedAt: number;
	createdAt: number;
	profile?: string;
	proxy?: string;
}

interface BrowserSessionPoolOptions {
	maxPoolSize?: number;
	maxIdleMs?: number;
}

const sessions = new Map<string, BrowserSession>();
let poolOptions: BrowserSessionPoolOptions = {};

export function configurePool(options: BrowserSessionPoolOptions): void {
	poolOptions = options;
}

/** Get or create a browser session by ID. */
export async function acquireBrowserSession(
	id: string,
	options: {
		launchBrowser: () => Promise<Browser>;
		safetyCheck: BrowserSafetyCheck;
		profile?: string;
		proxy?: string;
		headers?: Record<string, string>;
	},
): Promise<{ page: Page; session: BrowserSession }> {
	cleanupIdleSessions();

	let session = sessions.get(id);
	if (session) {
		session.lastUsedAt = Date.now();
		const page = await session.context.newPage();
		return { page, session };
	}

	// Evict if at capacity
	const maxSize = poolOptions.maxPoolSize ?? 5;
	if (sessions.size >= maxSize) {
		evictLRUSession();
	}

	const browser = await options.launchBrowser();
	const context = await browser.newContext({
		extraHTTPHeaders: options.headers,
		serviceWorkers: "block",
		proxy: options.proxy ? { server: options.proxy } : undefined,
	});
	const guard = createBrowserRouteGuard(options.safetyCheck);
	// oxlint-disable-next-line typescript/no-explicit-any -- bridge between route-guard.ts minimal Route and Playwright's full Route type
	await context.route("**/*", guard.handler as (route: any) => Promise<void>);

	session = {
		id,
		browser,
		context,
		guard,
		createdAt: Date.now(),
		lastUsedAt: Date.now(),
		profile: options.profile,
		proxy: options.proxy,
	};
	sessions.set(id, session);

	const page = await context.newPage();
	return { page, session };
}

/** Release a session back to the pool without closing. */
export function releaseBrowserSession(id: string): void {
	const session = sessions.get(id);
	if (session) {
		session.lastUsedAt = Date.now();
	}
}

/** Destroy a session and close its browser. */
export async function destroyBrowserSession(id: string): Promise<void> {
	const session = sessions.get(id);
	if (!session) return;
	sessions.delete(id);
	await session.context.close().catch(() => {
		/* no-op */
	});
	await session.browser.close().catch(() => {
		/* no-op */
	});
}

/** List active session IDs. */
export function listBrowserSessions(): string[] {
	cleanupIdleSessions();
	return [...sessions.keys()];
}

/** Close all sessions. */
export async function closeAllBrowserSessions(): Promise<void> {
	for (const [id] of sessions) {
		await destroyBrowserSession(id);
	}
	sessions.clear();
}

function cleanupIdleSessions(): void {
	const maxIdle = poolOptions.maxIdleMs ?? 24 * 60 * 60 * 1_000;
	const cutoff = Date.now() - maxIdle;
	for (const [id, session] of sessions) {
		if (session.lastUsedAt < cutoff) {
			destroyBrowserSession(id).catch(() => {
				/* no-op */
			});
		}
	}
}

function evictLRUSession(): void {
	let oldest: BrowserSession | undefined;
	for (const session of sessions.values()) {
		if (!oldest || session.lastUsedAt < oldest.lastUsedAt) {
			oldest = session;
		}
	}
	if (oldest) {
		destroyBrowserSession(oldest.id).catch(() => {
			/* no-op */
		});
	}
}
