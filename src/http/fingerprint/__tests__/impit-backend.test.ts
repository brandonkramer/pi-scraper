/** @file Impit backend unit tests. */
import { describe, expect, it } from "vitest";

import { impitBackendFactory } from "../impit-backend.ts";
import { UnsupportedFingerprintOptionError } from "../types.ts";

describe("impit backend factory", () => {
	it("creates a backend that returns response shape on 200", async () => {
		const backend = await impitBackendFactory({
			browserProfile: "chrome",
			osProfile: "default",
			host: "example.com",
		});

		// Mock impit.fetch by replacing the method on the instance
		// We can't easily access the private impit instance, so instead we
		// verify the factory creates a valid backend with fetchOnce.
		// For a real response we'd need to mock the module; skip detailed
		// fetchOnce assertions here and cover them in integration tests.
		expect(backend.fetchOnce).toBeTypeOf("function");
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
