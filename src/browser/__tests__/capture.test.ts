/** @file Security guards for the browser capture / cookie-bridge surface (real, unmocked). */
import { describe, expect, it } from "vitest";

import {
	browserEvaluate,
	browserExportCookies,
	browserLiveCapture,
	browserScreenshot,
} from "../capture.ts";

// All cases below reject during input validation, before any browser/network work,
// so no session pool or DNS is exercised.
describe("browserExportCookies input guards", () => {
	it("rejects a path-traversal sessionId", async () => {
		await expect(
			browserExportCookies({ sessionId: "../evil", scopeUrl: "https://example.com" }),
		).rejects.toThrow(/Invalid sessionId/u);
	});

	it("rejects a path-traversal targetSessionId", async () => {
		await expect(
			browserExportCookies({
				sessionId: "checkout",
				targetSessionId: "../evil",
				scopeUrl: "https://example.com",
			}),
		).rejects.toThrow(/Invalid sessionId/u);
	});

	it("rejects a scopeUrl that resolves to a private/reserved address", async () => {
		await expect(
			browserExportCookies({ sessionId: "checkout", scopeUrl: "http://169.254.169.254/" }),
		).rejects.toThrow(/private|blocked/iu);
	});

	it("rejects a non-http(s) scopeUrl", async () => {
		await expect(
			browserExportCookies({ sessionId: "checkout", scopeUrl: "file:///etc/passwd" }),
		).rejects.toThrow(/http/iu);
	});
});

describe("browserLiveCapture input guards", () => {
	it("rejects a path-traversal sessionId", async () => {
		await expect(browserLiveCapture({ sessionId: "../evil" })).rejects.toThrow(
			/Invalid sessionId/u,
		);
	});
});

describe("browserScreenshot input guards", () => {
	it("rejects a path-traversal sessionId", async () => {
		await expect(browserScreenshot({ sessionId: "../evil" })).rejects.toThrow(/Invalid sessionId/u);
	});
});

describe("browserEvaluate input guards", () => {
	it("rejects a path-traversal sessionId", async () => {
		await expect(browserEvaluate({ sessionId: "../evil", script: "1+1" })).rejects.toThrow(
			/Invalid sessionId/u,
		);
	});
});
