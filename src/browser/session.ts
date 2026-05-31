/** @file Browser storage-state session persistence — save/load/cleanup for Playwright context.state. */
import { mkdir, readFile, readdir, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolvePiStoragePaths } from "../storage/paths.ts";

const DEFAULT_TTL_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Validate sessionId to prevent path traversal (.., ., separators, null bytes). */
export function validateSessionId(sessionId: string): void {
	if (
		sessionId === "." ||
		sessionId === ".." ||
		sessionId.includes("\0") ||
		sessionId.includes("/") ||
		sessionId.includes("\\")
	) {
		throw new Error(`Invalid sessionId: ${sessionId}`);
	}
}

/** Resolve the storage-state JSON path for a sessionId. */
export function resolveBrowserSessionStoragePath(sessionId: string): string {
	validateSessionId(sessionId);
	const paths = resolvePiStoragePaths();
	return path.join(paths.sessions, encodeURIComponent(sessionId), "storage.json");
}

/** Resolve the Cloak persistent profile directory for a sessionId. */
export function resolveCloakSessionProfilePath(sessionId: string): string {
	validateSessionId(sessionId);
	const paths = resolvePiStoragePaths();
	return path.join(paths.sessions, encodeURIComponent(sessionId), "cloak-profile");
}

/** Save a Playwright storage-state object to disk for the given sessionId. */
export async function saveBrowserSessionStorageState(
	sessionId: string,
	storageState: unknown,
): Promise<void> {
	const filePath = resolveBrowserSessionStoragePath(sessionId);
	await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	await writeFile(filePath, JSON.stringify(storageState), { encoding: "utf-8", mode: 0o600 });
}

/** Load a previously saved Playwright storage-state object, or undefined if missing. */
export async function loadBrowserSessionStorageState(
	sessionId: string,
): Promise<unknown | undefined> {
	const filePath = resolveBrowserSessionStoragePath(sessionId);
	try {
		const data = await readFile(filePath, "utf-8");
		return JSON.parse(data) as unknown;
	} catch {
		return undefined;
	}
}

/** Attempt to remove the session skeleton directory if empty. */
async function removeSessionDirIfEmpty(sessionId: string): Promise<void> {
	// Derive directory from the resolved storage path to match encoded session IDs
	const sessionDir = path.dirname(resolveBrowserSessionStoragePath(sessionId));
	try {
		await rmdir(sessionDir);
	} catch {
		/* non-empty or already gone — OK */
	}
}

/** Delete the on-disk storage-state JSON for a sessionId. */
export async function deleteBrowserSessionStorageState(sessionId: string): Promise<void> {
	const filePath = resolveBrowserSessionStoragePath(sessionId);
	try {
		await unlink(filePath);
		await removeSessionDirIfEmpty(sessionId);
	} catch {
		/* ignore if file doesn't exist */
	}
}

/** Delete the Cloak persistent profile directory for a sessionId. */
export async function deleteCloakSessionProfile(sessionId: string): Promise<void> {
	const dirPath = resolveCloakSessionProfilePath(sessionId);
	try {
		await rm(dirPath, { recursive: true, force: true });
		await removeSessionDirIfEmpty(sessionId);
	} catch {
		/* ignore if directory doesn't exist */
	}
}

/** Delete browser session storage-state files older than maxAgeDays (default 7). */
export async function cleanupExpiredBrowserSessions(maxAgeDays = DEFAULT_TTL_DAYS): Promise<void> {
	const paths = resolvePiStoragePaths();
	try {
		const entries = await readdir(paths.sessions, { withFileTypes: true });
		const cutoff = Date.now() - maxAgeDays * MS_PER_DAY;
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const storagePath = path.join(paths.sessions, entry.name, "storage.json");
			let expired = false;
			try {
				const stats = await stat(storagePath);
				if (stats.mtimeMs < cutoff) {
					await unlink(storagePath);
					expired = true;
				}
			} catch {
				/* ignore if storage.json doesn't exist */
			}
			// Also remove stale Cloak profiles (no storage.json or expired)
			const cloakPath = path.join(paths.sessions, entry.name, "cloak-profile");
			try {
				const cloakStats = await stat(cloakPath);
				if (expired || cloakStats.mtimeMs < cutoff) {
					await rm(cloakPath, { recursive: true, force: true });
				}
			} catch {
				/* ignore if cloak-profile doesn't exist */
			}

			// Clean up the session directory if it's now empty
			const sessionDir = path.join(paths.sessions, entry.name);
			try {
				await rmdir(sessionDir);
			} catch {
				/* non-empty or already gone — OK */
			}
		}
	} catch {
		/* ignore if directory doesn't exist */
	}
}
