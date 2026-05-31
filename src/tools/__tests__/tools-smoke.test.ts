/** @file Tools **tests** tools-smoke.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RenderComponent } from "../../tui/index.ts";
import type { PiToolShell, ToolContext } from "../../types.ts";
import { webTools } from "../infra/register.ts";

let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-tools-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
});

function formatSmokeStatus(envelope: ToolContext): string {
	return envelope.error ? `error:${envelope.error.code}` : `status:${envelope.status ?? "ok"}`;
}

function formatSmokeDuration(envelope: ToolContext): string {
	return typeof envelope.timing?.durationMs === "number"
		? `${envelope.timing.durationMs.toFixed(0)}ms`
		: "-";
}

function formatSmokeUpdates(updates: unknown[]): string {
	return updates.length > 0 ? `updates:${updates.length}` : "updates:0";
}

function firstText(result: { content: Array<{ text?: string }> }): string {
	return result.content[0]?.text ?? "";
}

describe("registered web tools smoke test", () => {
	for (const tool of webTools) {
		it(`${tool.name} → returns Pi result shell, renders call/result`, async () => {
			const signal = new AbortController().signal;
			const updates: PiToolShell[] = [];
			const params = smokeParams(tool.name);

			const result = await tool.execute("smoke-tool-call", params as never, signal, (update) => {
				updates.push(update);
			});

			expect(result.content[0]?.type).toBe("text");
			expect(typeof result.content[0]?.text).toBe("string");
			expect(result.details).toBeTruthy();
			const callText = renderComponentText(tool.renderCall?.(params as never, undefined));
			expect(callText).toContain(tool.name);
			expect(
				renderComponentText(tool.renderResult?.(result, { expanded: false }, undefined)),
			).toBeTruthy();

			const envelope = result.details as ToolContext;
			const text = firstText(result);
			const preview = text.replaceAll(/\s+/gu, " ").trim().slice(0, 80);
			console.info(
				`[smoke] ${tool.name.padEnd(22)} ${formatSmokeStatus(envelope).padEnd(28)} ${formatSmokeDuration(envelope).padEnd(8)} ${formatSmokeUpdates(updates).padEnd(12)} ${preview}`,
			);
		});
	}
});

function renderComponentText(component: RenderComponent | undefined): string {
	return component?.render(80).join("\n") ?? "";
}

function smokeParams(name: string): unknown {
	switch (name) {
		case "web_scrape":
			return { url: "http://127.0.0.1/", mode: "fast", timeoutSeconds: 1 };
		case "web_crawl":
			return {
				url: "http://127.0.0.1/",
				maxPages: 1,
				maxDepth: 0,
				mode: "fast",
				timeoutSeconds: 1,
			};
		case "web_map":
			return { url: "http://127.0.0.1/", maxSitemaps: 1 };
		case "web_batch":
			return {
				urls: ["http://127.0.0.1/"],
				mode: "fast",
				concurrency: 1,
				timeoutSeconds: 1,
			};
		case "web_extract":
			return { action: "list" };
		case "web_summarize":
			return { content: "A short local text to summarize.", sentences: 1 };
		case "web_get_result":
			return { jobId: "missing-job" };
		default:
			throw new Error("Missing smoke params");
	}
}
