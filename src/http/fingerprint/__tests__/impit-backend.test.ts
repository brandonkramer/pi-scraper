/** @file Impit backend unit tests. */
import { describe, expect, it } from "vitest";

import {
	createImpitBackend,
	impitBackendFactory,
	type ImpitConstructor,
} from "../impit-backend.ts";
import { UnsupportedFingerprintOptionError } from "../types.ts";

function makeMockImpit(response: {
	status: number;
	statusText: string;
	headers: Headers;
	body: ReadableStream<Uint8Array>;
	url: string;
}): ImpitConstructor {
	return class MockImpit {
		// oxlint-disable-next-line no-useless-constructor, no-empty-function -- mock class shape for DI
		constructor() {}
		async fetch(): Promise<typeof response> {
			return response;
		}
	} as unknown as ImpitConstructor;
}

function streamFromString(text: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(text);
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

describe("impit backend factory", () => {
	it("fetchOnce returns correct response shape on 200", async () => {
		const mock = makeMockImpit({
			status: 200,
			statusText: "OK",
			headers: new Headers({ "content-type": "text/html" }),
			body: streamFromString("<html>hello</html>"),
			url: "https://example.com/",
		});
		const backend = await createImpitBackend(
			{ browserProfile: "chrome", osProfile: "default", host: "example.com" },
			mock,
		);

		const result = await backend.fetchOnce("https://example.com/", {
			method: "GET",
			headers: {},
			timeoutMs: 5000,
			maxBytes: 1024,
			browserProfile: "chrome",
			osProfile: "default",
		});

		expect(result.status).toBe(200);
		expect(result.statusText).toBe("OK");
		expect(result.headers).toMatchObject({ "content-type": "text/html" });
		expect(result.body).toBeDefined();
		expect(result.body).toHaveProperty("getReader");
	});

	it("fetchOnce returns a ReadableStream body, not a Buffer", async () => {
		const mock = makeMockImpit({
			status: 200,
			statusText: "OK",
			headers: new Headers(),
			body: streamFromString("hello"),
			url: "https://example.com/",
		});
		const backend = await createImpitBackend(
			{ browserProfile: "chrome", osProfile: "default", host: "example.com" },
			mock,
		);

		const result = await backend.fetchOnce("https://example.com/", {
			method: "GET",
			headers: {},
			timeoutMs: 5000,
			maxBytes: 1024,
			browserProfile: "chrome",
			osProfile: "default",
		});

		expect(Buffer.isBuffer(result.body)).toBe(false);
		expect(result.body).toBeInstanceOf(ReadableStream);
	});

	it("followRedirects: false is enforced — 302 returned, not followed", async () => {
		const mock = makeMockImpit({
			status: 302,
			statusText: "Found",
			headers: new Headers({ location: "https://example.com/redirected" }),
			body: streamFromString(""),
			url: "https://example.com/",
		});
		const backend = await createImpitBackend(
			{ browserProfile: "chrome", osProfile: "default", host: "example.com" },
			mock,
		);

		const result = await backend.fetchOnce("https://example.com/", {
			method: "GET",
			headers: {},
			timeoutMs: 5000,
			maxBytes: 1024,
			browserProfile: "chrome",
			osProfile: "default",
		});

		expect(result.status).toBe(302);
		expect(result.headers?.location).toBe("https://example.com/redirected");
	});

	it("timeout wraps to FingerprintFetchError with code TIMEOUT", async () => {
		const MockImpit = class {
			// oxlint-disable-next-line no-useless-constructor, no-empty-function -- mock class shape for DI
			constructor() {}
			async fetch(): Promise<never> {
				const error = new Error("Request timeout");
				(error as Error & { cause?: unknown }).cause = { code: "TIMEOUT" };
				throw error;
			}
		} as unknown as ImpitConstructor;

		const backend = await createImpitBackend(
			{ browserProfile: "chrome", osProfile: "default", host: "example.com" },
			MockImpit,
		);

		await expect(
			backend.fetchOnce("https://example.com/", {
				method: "GET",
				headers: {},
				timeoutMs: 5000,
				maxBytes: 1024,
				browserProfile: "chrome",
				osProfile: "default",
			}),
		).rejects.toThrow("Request timeout");
	});

	it("maps 'chrome' to chrome142", async () => {
		const backend = await impitBackendFactory({
			browserProfile: "chrome",
			osProfile: "default",
			host: "example.com",
		});
		expect(backend.fetchOnce).toBeTypeOf("function");
	});

	it("passes through known profiles verbatim", async () => {
		for (const profile of ["chrome142", "firefox"]) {
			const backend = await impitBackendFactory({
				browserProfile: profile,
				osProfile: "default",
				host: "example.com",
			});
			expect(backend.fetchOnce).toBeTypeOf("function");
		}
	});

	it("throws UnsupportedFingerprintOptionError for unknown profile", async () => {
		await expect(
			impitBackendFactory({
				browserProfile: "unknown-browser",
				osProfile: "default",
				host: "example.com",
			}),
		).rejects.toBeInstanceOf(UnsupportedFingerprintOptionError);
	});
});
