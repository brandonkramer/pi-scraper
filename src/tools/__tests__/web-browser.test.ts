/** @file All web_browser tool tests — validation, storeCapture, capture actions, payload helpers. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserEvaluate, browserScreenshot } from "../../browser/capture.ts";
import { browserAct, type BrowserActionResult } from "../../browser/playwright.ts";
import { resolveProxyParam } from "../../http/proxy-pool.ts";
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
let originalStorageRoot: string | undefined;

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
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	await closeStorageDbs();
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
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

	it("navigate defaults to the outline map; roles drill into the interactive list", async () => {
		const act = vi.mocked(browserAct);

		act.mockClear();
		await webBrowserTool.execute(
			"test",
			{ action: "navigate", sessionId: "s1", url: "https://example.com" } as never,
			signal,
		);
		expect(act.mock.calls[0]?.[0]).toMatchObject({ action: "navigate", detail: "outline" });

		act.mockClear();
		await webBrowserTool.execute(
			"test",
			{
				action: "navigate",
				sessionId: "s1",
				url: "https://example.com",
				roles: ["textbox"],
			} as never,
			signal,
		);
		const narrowed = act.mock.calls[0]?.[0];
		expect(narrowed?.detail).toBeUndefined(); // narrowed → interactive list, not outline
		expect(narrowed?.roles).toEqual(["textbox"]);
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
		expect(result.content[0]?.text).toContain("read (markdown · map)");
		const stored = await readResponse(details.responseId!, { rootDir });
		expect(isBrowserCapturePayload(stored.value)).toBe(false);
		expect((stored.value as { kind: string }).kind).toBe("browser_live_capture");
	});

	it("returns an orientation digest (not the body) when read has no needles", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "read", sessionId: "checkout", format: "markdown" } as never,
			signal,
		);
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("read (markdown · map)");
		expect(text).toContain("outline:");
		expect(text).toContain("# Account  (line 1)");
		expect(text).toContain("→ linesMatching:");
		// Body past the headings is not dumped inline — that's the whole point.
		expect(text).not.toContain("Plan: Pro");

		const data = (result.details as ToolContext<{ digest?: string }>).data;
		expect(data?.digest).toContain("outline:");

		// Status line: code leads, action carries the rung — "● 200 · read (map) · …".
		const collapsed =
			webBrowserTool.renderResult?.(result, { expanded: false }).render(120).join("\n") ?? "";
		expect(collapsed).toContain("read (map)");
		expect(collapsed.indexOf("200")).toBeLessThan(collapsed.indexOf("read (map)"));
	});

	it("includes landmark counts in the read digest", async () => {
		const { browserLiveCapture } = await import("../../browser/capture.ts");
		vi.mocked(browserLiveCapture).mockResolvedValueOnce({
			url: "https://example.com/app",
			finalUrl: "https://example.com/app",
			status: 200,
			backend: "playwright",
			format: "markdown",
			durationMs: 5,
			data: {
				route: "html",
				extractionPath: ["browser"],
				markdown: "# Dashboard\n## Billing\nbody",
			},
			landmarks: { nav: true, main: true, forms: 2, buttons: 14, links: 38 },
		});
		const result = await webBrowserTool.execute(
			"test",
			{ action: "read", sessionId: "checkout", format: "markdown" } as never,
			signal,
		);
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("38 links");
		expect(text).toContain("## Billing  (line 2)");
		expect(text).toContain("landmarks: nav, main, 2 forms, 14 buttons");
	});

	it("greps page content to matching snippets when linesMatching is set", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{
				action: "read",
				sessionId: "checkout",
				format: "markdown",
				linesMatching: ["Plan"],
			} as never,
			signal,
		);
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("read (markdown · 1 match)");
		expect(text).toContain("Matching line snippets (1 match):");
		expect(text).toContain("> 2: Plan: Pro");
		// Non-matching heading line is filtered out of the inline body.
		expect(text).not.toContain("# Account");

		const data = (result.details as ToolContext<{ matches?: unknown[]; needles?: string[] }>).data;
		expect(data?.matches).toHaveLength(1);
		expect(data?.needles).toEqual(["Plan"]);

		// Expanded view surfaces the needles used plus the snippet block.
		const expanded =
			webBrowserTool.renderResult?.(result, { expanded: true }).render(120).join("\n") ?? "";
		expect(expanded).toContain('needles: "Plan"');
		expect(expanded).toContain("Plan: Pro");
	});

	it("coerces a string linesMatching to an array (no char-split, no render crash)", async () => {
		const result = await webBrowserTool.execute(
			"test",
			// Bare string, not an array — Type.Unsafe lets it through at runtime.
			{ action: "read", sessionId: "checkout", format: "markdown", linesMatching: "Plan" } as never,
			signal,
		);
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("> 2: Plan: Pro");

		const data = (result.details as ToolContext<{ matches?: unknown[]; needles?: unknown }>).data;
		expect(data?.matches).toHaveLength(1);
		expect(data?.needles).toEqual(["Plan"]);

		// Render must not throw on the (now array) needles.
		const expanded =
			webBrowserTool.renderResult?.(result, { expanded: true }).render(120).join("\n") ?? "";
		expect(expanded).toContain('needles: "Plan"');
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

describe("web_browser session context options", () => {
	const ctx = {
		sessionId: "ctx",
		timezone: "Europe/Paris",
		locale: "fr-FR",
		browserProfile: "UA/1.0",
	};

	it("threads timezone/locale/browserProfile to browserAct (navigate/inspect)", async () => {
		const act = vi.mocked(browserAct);
		act.mockClear();
		await webBrowserTool.execute("test", { action: "inspect", ...ctx } as never, signal);
		expect(act.mock.calls[0]?.[0]).toMatchObject({
			timezone: "Europe/Paris",
			locale: "fr-FR",
			browserProfile: "UA/1.0",
		});
	});

	it("threads timezone/locale/browserProfile to read (browserLiveCapture)", async () => {
		const { browserLiveCapture } = await import("../../browser/capture.ts");
		const cap = vi.mocked(browserLiveCapture);
		cap.mockClear();
		await webBrowserTool.execute("test", { action: "read", ...ctx } as never, signal);
		expect(cap.mock.calls[0]?.[0]).toMatchObject({
			timezone: "Europe/Paris",
			locale: "fr-FR",
			browserProfile: "UA/1.0",
		});
	});

	it("threads timezone/locale/browserProfile to screenshot", async () => {
		const shot = vi.mocked(browserScreenshot);
		shot.mockClear();
		await webBrowserTool.execute("test", { action: "screenshot", ...ctx } as never, signal);
		expect(shot.mock.calls[0]?.[0]).toMatchObject({
			timezone: "Europe/Paris",
			locale: "fr-FR",
			browserProfile: "UA/1.0",
		});
	});

	it("threads timezone/locale/browserProfile to evaluate", async () => {
		const ev = vi.mocked(browserEvaluate);
		ev.mockClear();
		await webBrowserTool.execute(
			"test",
			{ action: "evaluate", script: "1+1", ...ctx } as never,
			signal,
		);
		expect(ev.mock.calls[0]?.[0]).toMatchObject({
			timezone: "Europe/Paris",
			locale: "fr-FR",
			browserProfile: "UA/1.0",
		});
	});

	it("resolves a proxy array to a single rotated entry passed to browserAct", async () => {
		const act = vi.mocked(browserAct);
		const pool = ["http://p1:8080", "http://p2:8080"];
		act.mockClear();
		await webBrowserTool.execute(
			"test",
			{ action: "inspect", sessionId: "ctx", proxy: pool } as never,
			signal,
		);
		const used = act.mock.calls[0]?.[0]?.proxy;
		expect(typeof used).toBe("string");
		expect(pool).toContain(used);
		// resolveProxyParam rotates round-robin over the same array via a shared pool.
		const next = resolveProxyParam(pool);
		expect(pool).toContain(next);
		expect(next).not.toBe(used);
	});
});
