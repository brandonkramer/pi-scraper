/**
 * @fileoverview tools model-adapter module.
 */
import type {
	ModelAdapter,
	ModelRequest,
	ModelResponse,
} from "../extract/model.ts";
import { isUnknownRecord, type UnknownRecord } from "../types.ts";
type Runner = (
	payload: unknown,
	signal?: AbortSignal,
) => Promise<unknown> | unknown;

/**
 * Resolves the optional model adapter available to tool handlers.
 *
 * @remarks
 * Pi has evolved its model APIs over time, so this boundary intentionally uses
 * narrow duck typing. When a host exposes a selected-model runner, the tools can
 * call it; otherwise model-backed `web_scrape`, `web_extract`, and
 * `web_summarize` paths return
 * the stable `MODEL_ADAPTER_MISSING` error instead of throwing.
 */
export function resolveToolModelAdapter(
	source: unknown,
): ModelAdapter | undefined {
	if (isUnknownRecord(source)) {
		const configured = source.modelAdapter;
		if (isModelAdapter(configured)) return configured;
	}
	const runner = findRunner(source);
	if (!runner) return undefined;
	return {
		async run<T = unknown>(request: ModelRequest, signal?: AbortSignal) {
			const raw = await runner(buildModelPayload(request), signal);
			return normalizeModelResponse<T>(request, raw);
		},
	};
}

function findRunner(source: unknown): Runner | undefined {
	if (!isUnknownRecord(source)) return undefined;
	for (const key of ["runModel", "generate", "chat", "complete"] as const) {
		if (typeof source[key] === "function")
			return source[key].bind(source) as Runner;
	}
	for (const key of ["model", "selectedModel", "models"] as const) {
		const candidate = source[key];
		if (!isUnknownRecord(candidate)) continue;
		for (const method of ["run", "generate", "chat", "complete"] as const) {
			if (typeof candidate[method] === "function") {
				return candidate[method].bind(candidate) as Runner;
			}
		}
	}
	return undefined;
}

function buildModelPayload(request: ModelRequest): UnknownRecord {
	const prompt = modelPrompt(request);
	return {
		...request,
		prompt,
		messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
	};
}

function modelPrompt(request: ModelRequest): string {
	if (request.task === "summarize") {
		return `${request.prompt ?? "Summarize this page."}\n\n${request.input}`;
	}
	const schema = request.schema
		? `\nJSON schema or shape:\n${JSON.stringify(request.schema)}`
		: "";
	return [
		"Extract structured JSON from this page content.",
		request.prompt ? `Instructions: ${request.prompt}` : undefined,
		schema || undefined,
		"Return only JSON.",
		"",
		request.input,
	]
		.filter(Boolean)
		.join("\n");
}

function normalizeModelResponse<T>(
	request: ModelRequest,
	raw: unknown,
): ModelResponse<T> {
	if (isUnknownRecord(raw) && "data" in raw) {
		return raw as unknown as ModelResponse<T>;
	}
	const text = extractText(raw);
	const data =
		request.task === "extract" ? parseJsonOrText<T>(text) : (text as T);
	return { data, text, raw };
}

function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!isUnknownRecord(value)) return String(value ?? "");
	if (typeof value.text === "string") return value.text;
	if (typeof value.output === "string") return value.output;
	if (typeof value.message === "string") return value.message;
	if (Array.isArray(value.content)) {
		return value.content
			.map((item) => {
				if (typeof item === "string") return item;
				if (isUnknownRecord(item) && typeof item.text === "string")
					return item.text;
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return JSON.stringify(value);
}

function parseJsonOrText<T>(text: string): T {
	try {
		return JSON.parse(text) as T;
	} catch {
		return text as T;
	}
}

function isModelAdapter(value: unknown): value is ModelAdapter {
	return isUnknownRecord(value) && typeof value.run === "function";
}
