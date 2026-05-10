/**
 * @fileoverview http __tests__ fingerprint.test module.
 */
import { MockAgent } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createFingerprintFetchAdapter,
	type FingerprintBackendFactory,
	type FingerprintRequestBackend,
	getFingerprintFetchAdapter,
	registerFingerprintBackendFactory,
} from "../fingerprint/index.ts";

let agents: MockAgent[] = [];

afterEach(async () => {
	await Promise.all(agents.map((agent) => agent.close()));
	agents = [];
});

function mockAgent(): MockAgent {
	const agent = new MockAgent();
	agent.disableNetConnect();
	agents.push(agent);
	return agent;
}

function allowRobots(agent: MockAgent, origin: string): void {
	agent.get(origin).intercept({ path: "/robots.txt" }).reply(404, "");
}

describe("fingerprint fetch adapter", () => {
	it("uses an injected single-hop backend and pools it by profile and host", async () => {
		const agent = mockAgent();
		allowRobots(agent, "https://example.com");
		const backend: FingerprintRequestBackend = {
			fetchOnce: vi.fn(async () => ({
				status: 200,
				headers: { "content-type": "text/html" },
				body: "<html><body>fingerprinted</body></html>",
			})),
		};
		const factory: FingerprintBackendFactory = vi.fn(() => backend);
		const adapter = createFingerprintFetchAdapter(
			factory,
			{ browserProfile: "chrome120", osProfile: "macos" },
			{ dispatcher: agent, resolveDns: false },
		);

		await expect(
			adapter.fetch("https://example.com/a", { respectRobots: true }),
		).resolves.toMatchObject({
			url: "https://example.com/a",
			finalUrl: "https://example.com/a",
			status: 200,
			text: "<html><body>fingerprinted</body></html>",
		});
		await adapter.fetch("https://example.com/b", { respectRobots: false });

		expect(factory).toHaveBeenCalledTimes(1);
		expect(factory).toHaveBeenCalledWith({
			browserProfile: "chrome120",
			osProfile: "macos",
			host: "example.com",
			proxy: undefined,
		});
		expect(backend.fetchOnce).toHaveBeenCalledWith(
			"https://example.com/a",
			expect.objectContaining({
				browserProfile: "chrome120",
				osProfile: "macos",
				headers: expect.objectContaining({
					accept: expect.stringContaining("text/html"),
					"upgrade-insecure-requests": "1",
				}),
			}),
			expect.any(AbortSignal),
		);
	});

	it("reports a structured missing-backend error when no backend is configured", () => {
		expect(() => getFingerprintFetchAdapter()).toThrowError(
			expect.objectContaining({
				structured: expect.objectContaining({
					code: "FINGERPRINT_BACKEND_MISSING",
					phase: "fingerprint",
				}),
			}),
		);
	});

	it("uses a registered backend factory for configured fingerprint mode", async () => {
		const agent = mockAgent();
		allowRobots(agent, "https://configured.example");
		const backend: FingerprintRequestBackend = {
			fetchOnce: vi.fn(async () => ({
				status: 200,
				headers: { "content-type": "text/plain" },
				body: "configured",
			})),
		};
		const unregister = registerFingerprintBackendFactory(() => backend);
		try {
			const adapter = getFingerprintFetchAdapter(
				{ browserProfile: "chrome" },
				{ dispatcher: agent, resolveDns: false },
			);
			await expect(
				adapter.fetch("https://configured.example/"),
			).resolves.toMatchObject({ text: "configured" });
		} finally {
			unregister();
		}
	});

	it("rejects proxy options until a backend can enforce proxy safety", async () => {
		const adapter = createFingerprintFetchAdapter(() => ({
			fetchOnce: vi.fn(),
		}));

		await expect(
			adapter.fetch("https://example.com/", {
				proxy: "http://proxy.example:8080",
				respectRobots: false,
			}),
		).rejects.toMatchObject({
			structured: {
				code: "UNSUPPORTED_FINGERPRINT_OPTION",
				phase: "fingerprint",
			},
		});
	});

	it("blocks unsafe initial URLs before invoking the backend", async () => {
		const backend: FingerprintRequestBackend = { fetchOnce: vi.fn() };
		const adapter = createFingerprintFetchAdapter(() => backend);

		await expect(
			adapter.fetch("http://127.0.0.1/private", { respectRobots: false }),
		).rejects.toMatchObject({
			structured: {
				code: "PRIVATE_NETWORK_ADDRESS",
				phase: "url_safety",
			},
		});
		expect(backend.fetchOnce).not.toHaveBeenCalled();
	});

	it("revalidates redirect hops before requesting the next URL", async () => {
		const agent = mockAgent();
		allowRobots(agent, "https://example.com");
		const backend: FingerprintRequestBackend = {
			fetchOnce: vi.fn(async () => ({
				status: 302,
				headers: { location: "http://127.0.0.1/private" },
			})),
		};
		const adapter = createFingerprintFetchAdapter(
			() => backend,
			{},
			{
				dispatcher: agent,
				resolveDns: false,
			},
		);

		await expect(
			adapter.fetch("https://example.com/start"),
		).rejects.toMatchObject({
			structured: {
				code: "PRIVATE_NETWORK_ADDRESS",
				phase: "url_safety",
			},
		});
		expect(backend.fetchOnce).toHaveBeenCalledTimes(1);
	});
});
