import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent } from "undici";
import { closeStorageDbs } from "../../storage/db.js";
import { createHttpClient } from "../client.js";

let rootDir: string;
let agent: MockAgent;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-cache-"));
	agent = new MockAgent();
	agent.disableNetConnect();
});

afterEach(async () => {
	closeStorageDbs();
	await agent.close();
	await rm(rootDir, { recursive: true, force: true });
});

describe("HttpClient opt-in fetch cache", () => {
	it("serves a second GET from SQLite/blob cache when TTL is set", async () => {
		const client = createHttpClient({ dispatcher: agent, resolveDns: false, storage: { rootDir } });
		agent.get("https://example.com").intercept({ path: "/robots.txt" }).reply(404, "");
		agent.get("https://example.com").intercept({ path: "/cached" }).reply(200, "cached body", {
			headers: { "content-type": "text/plain" },
		});

		const first = await client.fetchUrl("https://example.com/cached", { cacheTtlSeconds: 3600 });
		const second = await client.fetchUrl("https://example.com/cached", { cacheTtlSeconds: 3600 });

		expect(first.text).toBe("cached body");
		expect(first.cache?.cached).toBe(false);
		expect(second.text).toBe("cached body");
		expect(second.cache?.cached).toBe(true);
	});

	it("does not persist no-store responses", async () => {
		const client = createHttpClient({ dispatcher: agent, resolveDns: false, storage: { rootDir } });
		agent.get("https://example.com").intercept({ path: "/robots.txt" }).reply(404, "");
		agent.get("https://example.com").intercept({ path: "/private" }).reply(200, "one", {
			headers: { "content-type": "text/plain", "cache-control": "no-store" },
		});
		agent.get("https://example.com").intercept({ path: "/private" }).reply(200, "two", {
			headers: { "content-type": "text/plain", "cache-control": "no-store" },
		});

		expect((await client.fetchUrl("https://example.com/private", { cacheTtlSeconds: 3600 })).text).toBe("one");
		expect((await client.fetchUrl("https://example.com/private", { cacheTtlSeconds: 3600 })).text).toBe("two");
	});
});
