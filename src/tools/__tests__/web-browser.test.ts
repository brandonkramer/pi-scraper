/** @file All web_browser tool tests — validation, storeCapture, capture actions, payload helpers. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserActionResult } from "../../browser/playwright.ts";
import {
	BROWSER_CAPTURE_KIND,
	buildBrowserCapturePayload,
	buildBrowserLiveCapturePayload,
	isBrowserCapturePayload,
} from "../../storage/browser-capture.ts";
import { closeStorageDbs } from "../../storage/db/open.ts";
import { readResponse } from "../../storage/responses/read.ts";
import { storeResponse } from "../../storage/responses/store.ts";
import type { ToolContext } from "../../types.ts";
import { isExtractSourceResolution, resolveExtractSource } from "../infra/extract-source.ts";
import type { ExtractSourceResolution } from "../infra/extract-source.ts";
import { webBrowserTool } from "../web-browser.ts";
import { createWebExtractTool } from "../web-extract.ts";
import { webGetResultTool } from "../web-get-result.ts";

const signal = new AbortController().signal;
let rootDir: string;

const mockAction: BrowserActionResult = {
	action: "snapshot",
	url: "https://example.com/account",
	snapshot: 'button "Save" [ref=e12]',
	backend: "playwright",
	durationMs: 12,
};

vi.mock("../../browser/playwright.ts", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		browserAct: vi.fn(async () => mockAction),
	};
});

vi.mock("../../browser/capture.ts", () => ({
	browserLiveCapture: vi.fn(async () => ({
		url: "https://example.com/account",
		finalUrl: "https://example.com/account",
		status: 200,
		backend: "playwright",
		format: "markdown",
		durationMs: 20,
		data: { route: "html", extractionPath: ["browser"], markdown: "# Account\nPlan: Pro" },
	})),
	browserExportCookies: vi.fn(async () => ({
		sourceSessionId: "checkout",
		targetSessionId: "checkout",
		scopeUrl: "https://example.com",
		cookieCount: 2,
		domains: ["example.com"],
	})),
	browserScreenshot: vi.fn(async () => ({
		url: "https://example.com/account",
		backend: "playwright",
		blobPath: "/tmp/fake-screenshot.png",
		byteLength: 1234,
		fullPage: false,
		durationMs: 15,
	})),
	browserEvaluate: vi.fn(async () => ({
		url: "https://example.com/account",
		backend: "playwright",
		result: '"hello"',
		truncated: false,
		durationMs: 8,
	})),
}));

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-browser-capture-"));
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	delete process.env.PI_SCRAPER_STORAGE_ROOT;
	closeStorageDbs();

	await rm(rootDir, { recursive: true, force: true });
	vi.clearAllMocks();
});

type ResolvedSource = Awaited<ReturnType<typeof resolveExtractSource>>;

// Narrowing helpers keep the `if (...) throw` guards out of test bodies (oxlint vitest/no-conditional-in-test).
function expectResolution(value: ResolvedSource): ExtractSourceResolution {
	if (!isExtractSourceResolution(value)) throw new Error("expected an ExtractSourceResolution");
	return value;
}

function expectErrorShell(value: ResolvedSource): Exclude<ResolvedSource, ExtractSourceResolution> {
	if (isExtractSourceResolution(value)) throw new Error("expected an error shell");
	return value;
}

describe("webBrowserTool validation", () => {
	it("requires sessionId", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "inspect", sessionId: "" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SESSION_MISSING");
	});

	it("requires url navigate", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "navigate", sessionId: "s1" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_URL_MISSING");
	});

	it("requires selector for click", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "click", sessionId: "s1" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SELECTOR_MISSING");
	});

	it("requires selector fill", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "fill", sessionId: "s1", value: "x" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SELECTOR_MISSING");
	});

	it("requires selector select", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "select", sessionId: "s1", value: "x" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SELECTOR_MISSING");
	});

	it("requires script for evaluate", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "evaluate", sessionId: "s1" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SCRIPT_MISSING");
	});

	it("requires sessionId for screenshot", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "screenshot", sessionId: "" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SESSION_MISSING");
	});

	it("requires sessionId for evaluate", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "evaluate", sessionId: "", script: "1+1" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SESSION_MISSING");
	});
});

describe("web_browser storeCapture", () => {
	it("returns responseId when storeCapture is true", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "inspect", sessionId: "checkout", storeCapture: true } as never,
			signal,
		);
		const details = result.details as ToolContext;
		expect(details.responseId).toBeTruthy();
		expect(details.fullOutputPath).toBeTruthy();
		expect(result.content[0]?.text).toContain("responseId:");
		expect(details.assistantGuidance).toContain("not a web_scrape diff snapshot");
	});

	it("retrieves stored browser capture via web_get_result", async () => {
		const stored = await webBrowserTool.execute(
			"test",
			{ action: "inspect", sessionId: "checkout", storeCapture: true } as never,
			signal,
		);
		const responseId = (stored.details as ToolContext).responseId!;
		const got = await webGetResultTool.execute("test", { responseId }, signal);
		const payload = (got.details as ToolContext).data as {
			kind: string;
			capture: { snapshot: string };
		};
		expect(payload.kind).toBe(BROWSER_CAPTURE_KIND);
		expect(payload.capture.snapshot).toContain('button "Save"');
	});

	it("behaves as before without storeCapture", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "inspect", sessionId: "checkout" } as never,
			signal,
		);
		expect((result.details as ToolContext).responseId).toBeUndefined();
	});
});

describe("web_extract responseId sources", () => {
	it("extracts from stored browser capture without fetch", async () => {
		const payload = buildBrowserCapturePayload({
			sessionId: "s1",
			action: "snapshot",
			url: "https://example.com/account",
			backend: "playwright",
			snapshot: 'heading "Account" [level=1]\nbutton "Save" [ref=e12]',
		});
		const meta = await storeResponse(payload, { rootDir, responseId: "cap-1" });
		const resolved = expectResolution(
			await resolveExtractSource({ responseId: meta.responseId }, "test", { storage: { rootDir } }),
		);
		expect(resolved.content).toContain("Account");
		expect(resolved.storedKind).toBe("stored_browser_capture");

		const extract = createWebExtractTool({
			modelAdapter: {
				run: async (req) => ({ data: { seen: req.input.slice(0, 20) } as never }),
			},
		});
		const result = await extract.execute(
			"test",
			{ action: "adhoc", responseId: meta.responseId, prompt: "name" },
			signal,
		);
		expect(result.content[0]?.text).toContain("seen");
		expect((result.details as ToolContext).sourceNotes?.[0]?.title).toContain("browser");
	});

	it("rejects selector extraction when stored capture has no HTML", async () => {
		const payload = buildBrowserCapturePayload({
			sessionId: "s1",
			action: "snapshot",
			url: "https://example.com",
			backend: "playwright",
			snapshot: "button only",
		});
		const meta = await storeResponse(payload, { rootDir, responseId: "cap-2" });
		const shell = expectErrorShell(
			await resolveExtractSource({ responseId: meta.responseId }, "selector", {
				requireHtml: true,
				storage: { rootDir },
			}),
		);
		expect((shell.details as ToolContext).error?.code).toBe("EXTRACT_SOURCE_NO_HTML");
	});

	it("extracts from stored scrape result", async () => {
		await storeResponse(
			{
				url: "https://example.com",
				data: { markdown: "# Hello", text: "Hello", route: "html", extractionPath: ["fast"] },
			},
			{ rootDir, responseId: "scrape-1" },
		);
		const resolved = expectResolution(
			await resolveExtractSource({ responseId: "scrape-1" }, "test", { storage: { rootDir } }),
		);
		expect(resolved.content).toContain("Hello");
		expect(resolved.storedKind).toBe("stored_scrape");
	});

	it("rejects ambiguous multiple primary sources", async () => {
		const shell = expectErrorShell(
			await resolveExtractSource({ url: "https://example.com", content: "inline" }, "test"),
		);
		expect((shell.details as ToolContext).error?.code).toBe("EXTRACT_SOURCE_AMBIGUOUS");
	});
});

describe("web_browser read action", () => {
	it("stores live capture with responseId", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "read", sessionId: "checkout", format: "markdown", storeCapture: true } as never,
			signal,
		);
		const details = result.details as ToolContext;
		expect(details.responseId).toBeTruthy();
		expect(result.content[0]?.text).toContain("read (markdown)");
		const stored = await readResponse(details.responseId!, { rootDir });
		expect(isBrowserCapturePayload(stored.value)).toBe(false);
		expect((stored.value as { kind: string }).kind).toBe("browser_live_capture");
	});

	it("stores screenshot with responseId and text-only content", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "screenshot", sessionId: "checkout" } as never,
			signal,
		);
		const details = result.details as ToolContext;
		expect(details.responseId).toBeTruthy();
		expect(result.content[0]?.text).toContain("screenshot →");
		// "saved:" must reference the PNG blob, not the JSON response payload.
		expect(result.content[0]?.text).toContain("/tmp/fake-screenshot.png");
		expect(result.content.every((block) => block.type === "text")).toBe(true);
		// Status-line fields populated: action label + backend mode + duration.
		expect((details.data as { action?: string }).action).toBe("screenshot");
		expect(details.mode).toBe("playwright");
		expect(details.timing?.durationMs).toBe(15);
		const stored = await readResponse(details.responseId!, { rootDir });
		expect((stored.value as { kind: string }).kind).toBe("browser_screenshot");
	});

	it("retrieves stored screenshot via web_get_result (responseId → blobPath)", async () => {
		const shot = await webBrowserTool.execute(
			"test",
			{ action: "screenshot", sessionId: "checkout" } as never,
			signal,
		);
		const responseId = (shot.details as ToolContext).responseId!;
		const got = await webGetResultTool.execute("test", { responseId }, signal);
		const payload = (got.details as ToolContext).data as { kind: string; blobPath: string };
		expect(payload.kind).toBe("browser_screenshot");
		expect(payload.blobPath).toBe("/tmp/fake-screenshot.png");
	});

	it("exportCookies returns counts without values", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{
				action: "exportCookies",
				sessionId: "checkout",
				scopeUrl: "https://example.com",
			} as never,
			signal,
		);
		expect(result.content[0]?.text).toContain("2 cookie(s)");
		expect(result.content[0]?.text).not.toMatch(/sessionid=/iu);
		expect(result.content[0]?.text).toContain("Auth carry-over only");
	});
});

describe("browser capture payload helpers", () => {
	it("builds typed payloads without cookies", async () => {
		const capture = buildBrowserCapturePayload({
			sessionId: "s",
			action: "snapshot",
			url: "https://example.com",
			backend: "cloak",
			snapshot: 'link "Home"',
		});
		expect(JSON.stringify(capture)).not.toContain("cookie");
		const live = buildBrowserLiveCapturePayload({
			sessionId: "s",
			url: "https://example.com",
			backend: "cloak",
			format: "markdown",
			data: { route: "html", extractionPath: ["browser"], markdown: "hi" },
		});
		expect(live.kind).toBe("browser_live_capture");
	});
});
