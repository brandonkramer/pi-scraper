/**
 * @file Browser subresource route guard — installs a once-per-context handler that blocks unsafe
 *   URLs.
 */
import { assertSafeUrl, type SafeUrlResult, UrlSafetyError } from "../http/url-safety.ts";
import type { StructuredError } from "../types.ts";

export class BrowserRenderError extends Error {
	readonly structured: StructuredError;

	constructor(structured: StructuredError) {
		super(structured.message);
		this.name = "BrowserRenderError";
		this.structured = structured;
	}
}

export type BrowserSafetyCheck = (input: string | URL) => Promise<SafeUrlResult>;

export interface BrowserSafetyState {
	check: BrowserSafetyCheck;
	checkedHosts: Map<string, Promise<SafeUrlResult>>;
}

export interface BrowserRouteGuard {
	handler: (route: Route) => Promise<void>;
	consumeError(page: Page, url: string): BrowserRenderError | undefined;
	/**
	 * Bind a page-scoped checked-hosts map for handler dedup. Must be called after the page is
	 * created and before page.goto() is invoked. Per-page binding isolates concurrent renders that
	 * share a session context.
	 */
	setCheckedHostsForPage(page: Page, checkedHosts: Map<string, Promise<SafeUrlResult>>): void;
}

interface BlockedEntry {
	cause: unknown;
	finalUrl: string;
}

export function createBrowserRouteGuard(safetyCheck: BrowserSafetyCheck): BrowserRouteGuard {
	const blockedByPage = new WeakMap<Page, BlockedEntry>();
	const checkedHostsByPage = new WeakMap<Page, Map<string, Promise<SafeUrlResult>>>();

	async function handler(route: Route): Promise<void> {
		let page: Page;
		try {
			page = route.request().frame().page();
		} catch {
			// Unattached request (service worker or detached frame). Block conservatively.
			await route.abort("blockedbyclient").catch(() => {
				/* no-op */
			});
			return;
		}
		const requestUrl = route.request().url();
		const routePolicy = browserRoutePolicy(requestUrl);
		if (routePolicy.action === "allow") {
			await route.continue();
			return;
		}
		if (routePolicy.action === "block") {
			if (!blockedByPage.has(page)) {
				blockedByPage.set(page, { cause: routePolicy.cause, finalUrl: requestUrl });
			}
			await route.abort("blockedbyclient").catch(() => {
				/* no-op */
			});
			return;
		}
		const checkedHosts = checkedHostsByPage.get(page);
		if (!checkedHosts) {
			// Render hasn't bound a checked-hosts map yet. Deny rather than validate against a
			// shared/leaked map.
			await route.abort("blockedbyclient").catch(() => {
				/* no-op */
			});
			return;
		}
		const pageState: BrowserSafetyState = { check: safetyCheck, checkedHosts };
		try {
			await assertSafeBrowserUrl(requestUrl, requestUrl, requestUrl, pageState);
		} catch (error) {
			if (error instanceof BrowserRenderError) {
				if (!blockedByPage.has(page)) {
					blockedByPage.set(page, { cause: error.structured.cause, finalUrl: requestUrl });
				}
				await route.abort("blockedbyclient").catch(() => {
					/* no-op */
				});
				return;
			}
			await route.continue();
			return;
		}
		await route.continue();
	}

	function consumeError(page: Page, url: string): BrowserRenderError | undefined {
		const entry = blockedByPage.get(page);
		blockedByPage.delete(page);
		if (!entry) return undefined;
		return blockedRequestError(entry.cause, url, entry.finalUrl);
	}

	function setCheckedHostsForPage(
		page: Page,
		checkedHosts: Map<string, Promise<SafeUrlResult>>,
	): void {
		checkedHostsByPage.set(page, checkedHosts);
	}

	return { handler, consumeError, setCheckedHostsForPage };
}

export async function assertSafeBrowserUrl(
	input: string | URL,
	url: string,
	finalUrl?: string,
	state?: BrowserSafetyState,
): Promise<SafeUrlResult> {
	try {
		if (!state) return assertSafeUrl(input);
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
): { action: "validate" } | { action: "allow" } | { action: "block"; cause: unknown } {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch (cause) {
		return { action: "block", cause };
	}
	const protocol = parsed.protocol.toLowerCase();
	if (protocol === "http:" || protocol === "https:") return { action: "validate" };
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

function blockedRequestError(cause: unknown, url: string, finalUrl: string): BrowserRenderError {
	const causeMessage = cause instanceof Error ? cause.message : "URL failed safety checks";
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

export interface Route {
	abort(errorCode?: string): Promise<void>;
	continue(): Promise<void>;
	request(): Request;
}

export interface Request {
	url(): string;
	frame(): { page(): Page };
}

export interface Page {
	goto(url: string, options: Record<string, unknown>): Promise<{ status(): number } | null>;
	content(): Promise<string>;
	title(): Promise<string>;
	url(): string;
	close(): Promise<void>;
	context(): BrowserContext;
}

export interface BrowserContext {
	addCookies(cookies: Array<Record<string, string>>): Promise<void>;
	newPage(): Promise<Page>;
	route(glob: string, handler: (route: Route) => Promise<void>): Promise<void>;
}
