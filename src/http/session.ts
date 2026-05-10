/**
 * @fileoverview Lightweight session management for static HTTP requests.
 *
 * @remarks
 * Sessions store cookies, default headers, and profile preferences across
 * multiple requests. They are persisted in memory by default and optionally
 * saved to SQLite when `saveSession` is set.
 */
import { openStorageDb, type StorageDb } from "../storage/db/open.ts";
import type { ResolveStorageOptions } from "../storage/paths.ts";

export interface FetchSession {
	id: string;
	createdAt: string;
	lastUsedAt: string;
	cookies: SerializedCookie[];
	defaultHeaders?: Record<string, string>;
	defaultBrowserProfile?: string;
	defaultOsProfile?: string;
	defaultProxy?: string;
	defaultMode?: string;
}

interface SerializedCookie {
	name: string;
	value: string;
	domain?: string;
	path?: string;
	expires?: string;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: string;
}

const memorySessions = new Map<string, FetchSession>();

/**
 * Get an existing session from memory, load from SQLite, or create a new empty one.
 */
export async function getOrCreateSession(
	id: string,
	options: ResolveStorageOptions = {},
): Promise<FetchSession> {
	let session = memorySessions.get(id);
	if (!session) {
		session = await loadPersistedSession(id, options);
	}
	if (!session) {
		session = {
			id,
			createdAt: new Date().toISOString(),
			lastUsedAt: new Date().toISOString(),
			cookies: [],
		};
		memorySessions.set(id, session);
	} else {
		session.lastUsedAt = new Date().toISOString();
	}
	return session;
}

/**
 * Persist a memory session to SQLite.
 */
export async function saveSessionToStorage(
	id: string,
	options: ResolveStorageOptions = {},
): Promise<void> {
	const session = memorySessions.get(id);
	if (!session) return;
	await persistSession(session, options);
}

/**
 * Delete a session from memory and from SQLite.
 */
export async function deleteSessionAndStorage(
	id: string,
	options: ResolveStorageOptions = {},
): Promise<void> {
	memorySessions.delete(id);
	try {
		const db = await openStorageDb(options);
		db.prepare("DELETE FROM http_sessions WHERE id = ?").run(id);
	} catch {
		/* ignore storage errors on delete */
	}
}

/**
 * Delete a session from memory only.
 */
export function deleteSession(id: string): void {
	memorySessions.delete(id);
}

/**
 * List active session IDs in memory.
 */
export function listSessions(): string[] {
	return [...memorySessions.keys()];
}

/**
 * Parse a raw Set-Cookie header into a serialized cookie.
 */
export function parseSetCookie(
	setCookie: string,
	host?: string,
): SerializedCookie {
	const parts = setCookie.split(";").map((p) => p.trim());
	const [nameValue] = parts;
	const eq = nameValue.indexOf("=");
	const name = eq >= 0 ? nameValue.slice(0, eq).trim() : nameValue;
	const value = eq >= 0 ? nameValue.slice(eq + 1).trim() : "";

	const cookie: SerializedCookie = { name, value };
	for (const part of parts.slice(1)) {
		const [key, val] = part.split("=").map((s) => s.trim());
		const lower = key.toLowerCase();
		if (lower === "domain") cookie.domain = val;
		if (lower === "path") cookie.path = val;
		if (lower === "expires") cookie.expires = val;
		if (lower === "httponly") cookie.httpOnly = true;
		if (lower === "secure") cookie.secure = true;
		if (lower === "samesite") cookie.sameSite = val;
	}
	return cookie;
}

/**
 * Build a Cookie header string from stored cookies matching the target host and path.
 */
export function buildCookieHeader(
	session: FetchSession,
	host: string,
	path: string,
): string {
	const now = new Date();
	const matching = session.cookies.filter((c) => {
		if (c.expires) {
			const expiry = new Date(c.expires);
			if (expiry <= now) return false;
		}
		if (c.domain && !host.endsWith(c.domain)) return false;
		if (c.path && !path.startsWith(c.path)) return false;
		return true;
	});
	if (matching.length === 0) return "";
	return matching.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Merge session cookies (as outgoing Cookie header) with request headers.
 */
export function mergeSessionHeaders(
	session: FetchSession | undefined,
	host: string,
	path: string,
	headers: Record<string, string> | undefined,
): Record<string, string> {
	if (!session) return headers ?? {};
	const merged = { ...session.defaultHeaders, ...headers };
	const cookieHeader = buildCookieHeader(session, host, path);
	if (cookieHeader) {
		merged["cookie"] = cookieHeader;
	}
	return merged;
}

/**
 * Update session with Set-Cookie headers from a response.
 */
export function updateSessionCookies(
	session: FetchSession,
	setCookieHeaders: string[],
	host: string,
): void {
	for (const header of setCookieHeaders) {
		const cookie = parseSetCookie(header, host);
		// Remove old cookie with same name/domain/path
		session.cookies = session.cookies.filter(
			(c) =>
				!(
					c.name === cookie.name &&
					c.domain === cookie.domain &&
					c.path === cookie.path
				),
		);
		session.cookies.push(cookie);
	}
}

/**
 * Persist session metadata to SQLite.
 */
export async function persistSession(
	session: FetchSession,
	options: ResolveStorageOptions = {},
): Promise<void> {
	const db = await openStorageDb(options);
	db.db.exec(`
		CREATE TABLE IF NOT EXISTS http_sessions (
			id TEXT PRIMARY KEY,
			created_at TEXT NOT NULL,
			last_used_at TEXT NOT NULL,
			cookies_json TEXT NOT NULL,
			default_headers_json TEXT,
			default_browser_profile TEXT,
			default_os_profile TEXT,
			default_proxy TEXT,
			default_mode TEXT
		);
	`);
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO http_sessions
		(id, created_at, last_used_at, cookies_json, default_headers_json,
		 default_browser_profile, default_os_profile, default_proxy, default_mode)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	stmt.run(
		session.id,
		session.createdAt,
		session.lastUsedAt,
		JSON.stringify(session.cookies),
		JSON.stringify(session.defaultHeaders ?? {}),
		session.defaultBrowserProfile ?? null,
		session.defaultOsProfile ?? null,
		session.defaultProxy ?? null,
		session.defaultMode ?? null,
	);
}

/**
 * Load session metadata from SQLite into memory if not already present.
 */
export async function loadPersistedSession(
	id: string,
	options: ResolveStorageOptions = {},
): Promise<FetchSession | undefined> {
	if (memorySessions.has(id)) return memorySessions.get(id);
	const db = await openStorageDb(options);
	const row = db.prepare(`SELECT * FROM http_sessions WHERE id = ?`).get(id) as
		| {
				id: string;
				created_at: string;
				last_used_at: string;
				cookies_json: string;
				default_headers_json: string;
				default_browser_profile: string;
				default_os_profile: string;
				default_proxy: string;
				default_mode: string;
		  }
		| undefined;
	if (!row) return undefined;
	const session: FetchSession = {
		id: row.id,
		createdAt: row.created_at,
		lastUsedAt: row.last_used_at,
		cookies: JSON.parse(row.cookies_json) as SerializedCookie[],
	};
	if (row.default_headers_json) {
		try {
			session.defaultHeaders = JSON.parse(row.default_headers_json);
		} catch {
			/* ignore */
		}
	}
	if (row.default_browser_profile)
		session.defaultBrowserProfile = row.default_browser_profile;
	if (row.default_os_profile) session.defaultOsProfile = row.default_os_profile;
	if (row.default_proxy) session.defaultProxy = row.default_proxy;
	if (row.default_mode) session.defaultMode = row.default_mode;
	memorySessions.set(id, session);
	return session;
}

export interface SessionNoticeParams {
	sessionId?: string;
	saveSession?: boolean;
	clearSession?: boolean;
}

/**
 * Build a compact session status for tool renderers.
 */
export function buildSessionNotice(params: SessionNoticeParams): string {
	if (!params.sessionId) return "";
	if (params.saveSession)
		return `● session "${params.sessionId}" created & persisted`;
	if (params.clearSession) return `● session "${params.sessionId}" cleared`;
	return `● session "${params.sessionId}" active`;
}

/**
 * Build a human-readable session status line for fallback tool result text.
 */
export function buildSessionText(params: SessionNoticeParams): string {
	const notice = buildSessionNotice(params);
	return notice ? `\n\n---\n${notice}` : "";
}
