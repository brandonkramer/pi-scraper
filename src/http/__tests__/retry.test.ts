/** @file Http **tests** retry.test module. */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { MockAgent } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpClient } from "../client.ts";

let agents: MockAgent[] = [];

afterEach(async () => {
	await Promise.all(agents.map((agent) => agent.close()));
	agents = [];
});

function mockClient(retryAttempts = 1): {
	agent: MockAgent;
	client: ReturnType<typeof createHttpClient>;
} {
	const agent = new MockAgent();
	agent.disableNetConnect();
	agents.push(agent);
	return {
		agent,
		client: createHttpClient({
			dispatcher: agent,
			resolveDns: false,
			retryAttempts,
		}),
	};
}

function allowRobots(agent: MockAgent, origin: string): void {
	agent.get(origin).intercept({ path: "/robots.txt" }).reply(404, "");
}

type RetryServerState = {
	activePages: number;
	maxSecondWave: number;
	limited: boolean;
};

function createRetryTestServer(state: RetryServerState) {
	return createServer((request, response) => {
		if (request.url === "/robots.txt") {
			response.writeHead(404, { "content-type": "text/plain" });
			response.end("");
			return;
		}
		if (request.url === "/limited" && !state.limited) {
			state.limited = true;
			response.writeHead(429, {
				"content-type": "text/plain",
				"retry-after": "0",
			});
			response.end("slow down");
			return;
		}
		state.activePages += 1;
		state.maxSecondWave = Math.max(state.maxSecondWave, state.activePages);
		setTimeout(() => {
			response.writeHead(200, { "content-type": "text/plain" });
			response.end(request.url as string);
			state.activePages -= 1;
		}, 10);
	});
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

describe("HttpClient retry and rate-limit policy", () => {
	it("retries retryable status responses", async () => {
		const { agent, client } = mockClient(2);
		allowRobots(agent, "https://example.com");
		agent
			.get("https://example.com")
			.intercept({ path: "/flaky" })
			.reply(503, "try again", {
				headers: { "content-type": "text/plain", "retry-after": "0" },
			});
		agent
			.get("https://example.com")
			.intercept({ path: "/flaky" })
			.reply(200, "ok", {
				headers: { "content-type": "text/plain" },
			});

		await expect(client.fetchUrl("https://example.com/flaky")).resolves.toMatchObject({
			status: 200,
			text: "ok",
		});
	});

	it("respects Retry-After seconds before retrying", async () => {
		vi.useFakeTimers();
		const { agent, client } = mockClient(2);
		allowRobots(agent, "https://example.com");
		agent
			.get("https://example.com")
			.intercept({ path: "/limited" })
			.reply(429, "slow down", {
				headers: { "content-type": "text/plain", "retry-after": "10" },
			});
		agent
			.get("https://example.com")
			.intercept({ path: "/limited" })
			.reply(200, "ok", {
				headers: { "content-type": "text/plain" },
			});

		try {
			const pending = client.fetchUrl("https://example.com/limited");
			await vi.advanceTimersByTimeAsync(9_999);
			let settled = false;
			pending.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			await Promise.resolve();
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await expect(pending).resolves.toMatchObject({ status: 200, text: "ok" });
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses exponential retry backoff with configured jitter", async () => {
		vi.useFakeTimers();
		const { agent, client } = mockClient(2);
		allowRobots(agent, "https://example.com");
		agent
			.get("https://example.com")
			.intercept({ path: "/busy" })
			.reply(503, "busy", {
				headers: { "content-type": "text/plain" },
			});
		agent
			.get("https://example.com")
			.intercept({ path: "/busy" })
			.reply(200, "ok", {
				headers: { "content-type": "text/plain" },
			});

		try {
			const pending = client.fetchUrl("https://example.com/busy", {
				retryBaseDelayMs: 100,
				retryJitterMs: 0,
			});
			await vi.advanceTimersByTimeAsync(99);
			let settled = false;
			pending.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			await Promise.resolve();
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await expect(pending).resolves.toMatchObject({ status: 200, text: "ok" });
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not retry non-idempotent methods", async () => {
		const { agent, client } = mockClient(2);
		allowRobots(agent, "https://example.com");
		agent
			.get("https://example.com")
			.intercept({ path: "/submit", method: "POST" })
			.reply(503, "busy", {
				headers: { "content-type": "text/plain" },
			});

		await expect(
			client.fetchUrl("https://example.com/submit", { method: "POST" }),
		).resolves.toMatchObject({
			status: 503,
			text: "busy",
		});
	});

	it("reduces same-host concurrency after 429 responses", async () => {
		const state: RetryServerState = { activePages: 0, maxSecondWave: 0, limited: false };
		const server = createRetryTestServer(state);

		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		const { port } = server.address() as AddressInfo;
		const client = createHttpClient({
			allowPrivateNetwork: true,
			perHostConcurrency: 4,
			retryAttempts: 1,
		});
		try {
			await expect(client.fetchUrl(`http://127.0.0.1:${port}/limited`)).resolves.toMatchObject({
				status: 429,
			});
			const paths = ["/a", "/b", "/c", "/d"];
			await Promise.all(paths.map((path) => client.fetchUrl(`http://127.0.0.1:${port}${path}`)));
			expect(state.maxSecondWave).toBeLessThanOrEqual(2);
		} finally {
			await closeServer(server);
		}
	});
});
