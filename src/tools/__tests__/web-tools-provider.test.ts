/**
 * @file Web-tools-provider **tests** module. Tests model-adapter protocol routing in web_summarize
 *   and web_extract action=adhoc.
 */
import { describe, expect, it, beforeEach } from "vitest";

import type { ModelAdapter, ModelRequest } from "../../extract/adhoc/model.ts";
import { modelRegistry } from "../infra/model-registry.ts";
import { createWebExtractTool } from "../web-extract.ts";
import { createWebSummarizeTool } from "../web-summarize.ts";

const signal = new AbortController().signal;

function fakeAdapter(
	id: string,
	capabilities: Array<"summarize" | "extract">,
	priority = 50,
): ModelAdapter & { id: string; calls: ModelRequest[] } {
	const calls: ModelRequest[] = [];
	const adapter: ModelAdapter & { id: string; calls: ModelRequest[] } = {
		id,
		calls,
		async run<T>(req: ModelRequest, _signal?: AbortSignal) {
			calls.push(req);
			return { data: `from-${id}` as T };
		},
	};
	modelRegistry.register({
		id,
		label: id,
		capabilities,
		priority,
		adapter,
	});
	return adapter;
}

describe("web_summarize provider routing", () => {
	beforeEach(() => {
		modelRegistry.clear();
	});

	it("routes to registered adapter with provider=auto", async () => {
		fakeAdapter("gemini", ["summarize"]);
		const tool = createWebSummarizeTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		expect(result.content[0]?.text).toContain("from-gemini");
	});

	it("routes to explicit provider id", async () => {
		fakeAdapter("ollama", ["summarize"]);
		fakeAdapter("gemini", ["summarize"]);
		const tool = createWebSummarizeTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", sentences: 1, provider: "ollama" },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		expect(result.content[0]?.text).toContain("from-ollama");
	});

	it("returns MODEL_ADAPTER_MISSING with provider=off", async () => {
		fakeAdapter("gemini", ["summarize"]);
		const tool = createWebSummarizeTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", sentences: 1, provider: "off" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
	});

	it("returns MODEL_ADAPTER_NOT_FOUND for unknown id", async () => {
		const tool = createWebSummarizeTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", sentences: 1, provider: "nonexistent" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_NOT_FOUND",
		);
	});

	it("returns MODEL_ADAPTER_INCOMPATIBLE when id lacks capability", async () => {
		fakeAdapter("extract-only", ["extract"]);
		const tool = createWebSummarizeTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", sentences: 1, provider: "extract-only" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_INCOMPATIBLE",
		);
	});

	it("programmatic adapter beats registry", async () => {
		fakeAdapter("gemini", ["summarize"]);
		const tool = createWebSummarizeTool({
			modelAdapter: {
				async run<T>() {
					return { data: "injected" as T };
				},
			},
		});
		const result = await tool.execute("call", { content: "page text", sentences: 1 }, signal);
		expect(result.content[0]?.text).toContain("injected");
	});
});

describe("web_extract action=adhoc provider routing", () => {
	beforeEach(() => {
		modelRegistry.clear();
	});

	it("routes to registered adapter with provider=auto", async () => {
		fakeAdapter("gemini", ["extract"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract" },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		expect((result.details as { error?: unknown }).error).toBeUndefined();
	});

	it("routes to explicit provider id", async () => {
		fakeAdapter("ollama", ["extract"]);
		fakeAdapter("gemini", ["extract"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract", provider: "ollama" },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		expect((result.details as { error?: unknown }).error).toBeUndefined();
	});

	it("programmatic adapter beats registry", async () => {
		fakeAdapter("gemini", ["extract"]);
		const tool = createWebExtractTool({
			modelAdapter: {
				async run<T>() {
					return { data: "injected" as T };
				},
			},
		});
		const result = await tool.execute("call", { content: "page text", prompt: "extract" }, signal);
		expect((result.details as { error?: unknown }).error).toBeUndefined();
	});

	it("returns MODEL_ADAPTER_MISSING with provider=off", async () => {
		fakeAdapter("gemini", ["extract"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract", provider: "off" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
	});

	it("returns MODEL_ADAPTER_NOT_FOUND for unknown id", async () => {
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract", provider: "nonexistent" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_NOT_FOUND",
		);
	});

	it("returns MODEL_ADAPTER_INCOMPATIBLE when id lacks capability", async () => {
		fakeAdapter("summarize-only", ["summarize"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract", provider: "summarize-only" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_INCOMPATIBLE",
		);
	});
});
