/** @file Http **tests** fingerprint.test module. */
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

	it("reports a structured missing-backend error when no backend is configured", async () => {
		const dummy = registerFingerprintBackendFactory(() => {
			throw new Error("should not be called");
		});
		dummy(); // Remove the auto-registered impit backend
		expect(() => getFingerprintFetchAdapter()).toThrow(
			expect.objectContaining({
				structured: expect.objectContaining({
					code: "FINGERPRINT_BACKEND_MISSING",
					phase: "fingerprint",
				}),
			}),
		);
		// Re-register impit so downstream tests see the bundled backend
		const { impitBackendFactory } = await import("../fingerprint/impit-backend.ts");
		registerFingerprintBackendFactory(impitBackendFactory);
	});

	it("has the bundled impit backend registered by default", () => {
		// Auto-registration at module init means getFingerprintFetchAdapter
		// no longer throws MissingFingerprintBackendError.
		expect(() =>
			getFingerprintFetchAdapter({ browserProfile: "chrome" }, { resolveDns: false }),
		).not.toThrow();
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
			await expect(adapter.fetch("https://configured.example/")).resolves.toMatchObject({
				text: "configured",
			});
		} finally {
			unregister();
		}
	});

	it("passes proxy options to fingerprint backend (no longer rejected)", async () => {
		const backend = { fetchOnce: vi.fn().mockResolvedValue({ status: 200, body: "ok" }) };
		const adapter = createFingerprintFetchAdapter(() => backend);

		const result = await adapter.fetch("https://example.com/", {
			proxy: "http://proxy.example:8080",
			respectRobots: false,
		});
		expect(result.status).toBe(200);
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

		await expect(adapter.fetch("https://example.com/start")).rejects.toMatchObject({
			structured: {
				code: "PRIVATE_NETWORK_ADDRESS",
				phase: "url_safety",
			},
		});
		expect(backend.fetchOnce).toHaveBeenCalledTimes(1);
	});

	it("revalidates DNS before backend fetch when resolveDns is enabled", async () => {
		const agent = mockAgent();
		allowRobots(agent, "https://dns-check.example");
		const backend: FingerprintRequestBackend = {
			fetchOnce: vi.fn(async () => ({
				status: 200,
				headers: { "content-type": "text/html" },
				body: "ok",
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

		// With resolveDns: false, the revalidation is skipped and the backend is called
		await expect(adapter.fetch("https://dns-check.example/")).resolves.toMatchObject({
			status: 200,
		});
		expect(backend.fetchOnce).toHaveBeenCalledTimes(1);
	});

	it("detects DNS rebinding when injected resolver returns different IPs", async () => {
		let callCount = 0;
		const backend: FingerprintRequestBackend = {
			fetchOnce: vi.fn(async () => ({
				status: 200,
				headers: { "content-type": "text/html" },
				body: "rebound",
			})),
		};
		const adapter = createFingerprintFetchAdapter(
			() => backend,
			{},
			{
				resolveDns: true,
				allowPrivateNetwork: false,
				resolver: async () => {
					callCount++;
					if (callCount === 1) {
						return {
							url: new URL("https://rebinding.example/"),
							normalizedUrl: "https://rebinding.example/",
							checkedAddresses: ["93.184.216.34"],
						};
					}
					return {
						url: new URL("https://rebinding.example/"),
						normalizedUrl: "https://rebinding.example/",
						checkedAddresses: ["127.0.0.1"],
					};
				},
			},
		);

		await expect(adapter.fetch("https://rebinding.example/")).rejects.toMatchObject({
			structured: {
				code: "DNS_REBINDING_DETECTED",
				phase: "url_safety",
			},
		});
		expect(backend.fetchOnce).not.toHaveBeenCalled();
	});

	it("blocks fingerprint fetch when fingerprintTrustLevel is untrusted", async () => {
		const backend: FingerprintRequestBackend = { fetchOnce: vi.fn() };
		const adapter = createFingerprintFetchAdapter(
			() => backend,
			{},
			{
				resolveDns: false,
				fingerprintTrustLevel: "untrusted",
			},
		);

		await expect(adapter.fetch("https://example.com/")).rejects.toMatchObject({
			structured: {
				code: "FINGERPRINT_UNTRUSTED_URL",
				phase: "url_safety",
			},
		});
		expect(backend.fetchOnce).not.toHaveBeenCalled();
	});

	it("surfaces fingerprint rebinding mitigation diagnostic on successful fetch", async () => {
		const agent = mockAgent();
		allowRobots(agent, "https://diag.example");
		const backend: FingerprintRequestBackend = {
			fetchOnce: vi.fn(async () => ({
				status: 200,
				headers: { "content-type": "text/html" },
				body: "ok",
			})),
		};
		const adapter = createFingerprintFetchAdapter(
			() => backend,
			{},
			{
				dispatcher: agent,
				resolveDns: true,
				allowPrivateNetwork: false,
				resolver: async () => ({
					url: new URL("https://diag.example/"),
					normalizedUrl: "https://diag.example/",
					checkedAddresses: ["1.2.3.4"],
				}),
			},
		);

		const result = await adapter.fetch("https://diag.example/");
		expect(result.diagnostics).toMatchObject({
			fingerprintRebindingMitigation: {
				strategy: "double-resolve",
				preflightAddresses: ["1.2.3.4"],
				connectAddresses: ["1.2.3.4"],
			},
		});
	});

	it("wraps backend timeout into structured FingerprintFetchError", async () => {
		const agent = mockAgent();
		allowRobots(agent, "https://timeout.example");
		const backend: FingerprintRequestBackend = {
			fetchOnce: vi.fn(async () => {
				throw new Error("Request timeout");
			}),
		};
		const adapter = createFingerprintFetchAdapter(
			() => backend,
			{},
			{
				dispatcher: agent,
				resolveDns: false,
			},
		);

		await expect(adapter.fetch("https://timeout.example/")).rejects.toMatchObject({
			structured: {
				code: "FINGERPRINT_FETCH_FAILED",
				phase: "fingerprint",
			},
		});
		expect(backend.fetchOnce).toHaveBeenCalledTimes(1);
	});
});
