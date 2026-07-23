/**
 * @fileoverview http __tests__ cache.test module.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";
import { closeStorageDbs } from "../../storage/db/open.ts";
import { createHttpClient } from "../client.ts";

let rootDir: string;
let agent: MockAgent;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-cache-"));
	agent = new MockAgent();
	agent.disableNetConnect();
});

afterEach(async () => {
	vi.useRealTimers();
	await closeStorageDbs();
	await agent.close();
	await rm(rootDir, { recursive: true, force: true });
});

describe("HttpClient opt-in fetch cache", () => {
	it("serves a second GET from SQLite/blob cache when TTL is set", async () => {
		const client = createHttpClient({
			dispatcher: agent,
			resolveDns: false,
			storage: { rootDir },
		});
		agent
			.get("https://example.com")
			.intercept({ path: "/robots.txt" })
			.reply(404, "");
		agent
			.get("https://example.com")
			.intercept({ path: "/cached" })
			.reply(200, "cached body", {
				headers: { "content-type": "text/plain" },
			});

		const first = await client.fetchUrl("https://example.com/cached", {
			cacheTtlSeconds: 3600,
		});
		const second = await client.fetchUrl("https://example.com/cached", {
			cacheTtlSeconds: 3600,
		});

		expect(first.text).toBe("cached body");
		expect(first.cache?.cached).toBe(false);
		expect(second.text).toBe("cached body");
		expect(second.cache?.cached).toBe(true);
		expect(second.cache?.cachedAt).toBeDefined();
		expect(second.cache?.stale).toBe(false);
	});

	it("serves cached hits as stale when maxAgeSeconds is stricter than TTL", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
		const client = createHttpClient({
			dispatcher: agent,
			resolveDns: false,
			storage: { rootDir },
		});
		agent
			.get("https://example.com")
			.intercept({ path: "/robots.txt" })
			.reply(404, "");
		agent
			.get("https://example.com")
			.intercept({ path: "/cached-stale" })
			.reply(200, "cache may be stale", {
				headers: { "content-type": "text/plain" },
			});

		await client.fetchUrl("https://example.com/cached-stale", {
			cacheTtlSeconds: 3_600,
		});
		vi.setSystemTime(new Date("2024-01-01T00:02:00.000Z"));
		const second = await client.fetchUrl("https://example.com/cached-stale", {
			cacheTtlSeconds: 3_600,
			maxAgeSeconds: 60,
		});

		expect(second.text).toBe("cache may be stale");
		expect(second.cache).toMatchObject({
			cached: true,
			ageSeconds: 120,
			maxAgeSeconds: 60,
			stale: true,
		});
	});

	it("does not persist no-store responses", async () => {
		const client = createHttpClient({
			dispatcher: agent,
			resolveDns: false,
			storage: { rootDir },
		});
		agent
			.get("https://example.com")
			.intercept({ path: "/robots.txt" })
			.reply(404, "");
		agent
			.get("https://example.com")
			.intercept({ path: "/private" })
			.reply(200, "one", {
				headers: { "content-type": "text/plain", "cache-control": "no-store" },
			});
		agent
			.get("https://example.com")
			.intercept({ path: "/private" })
			.reply(200, "two", {
				headers: { "content-type": "text/plain", "cache-control": "no-store" },
			});

		expect(
			(
				await client.fetchUrl("https://example.com/private", {
					cacheTtlSeconds: 3600,
				})
			).text,
		).toBe("one");
		expect(
			(
				await client.fetchUrl("https://example.com/private", {
					cacheTtlSeconds: 3600,
				})
			).text,
		).toBe("two");
	});
});
