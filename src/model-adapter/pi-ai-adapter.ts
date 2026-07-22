/** @file Pi 0.81 model adapters for configured runtimes and the active Pi session model. */
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ModelsSimpleStreamOptions,
	Provider,
} from "@earendil-works/pi-ai";

import type {
	ModelAdapter,
	ModelRequest,
	ModelResponse,
	ModelUsage,
} from "../extract/adhoc/model.ts";

export interface PiAiAdapterOptions {
	provider: string;
	model: string;
}

export interface PiModelsClient {
	getModel(provider: string, model: string): Model<Api> | undefined;
	completeSimple(
		model: Model<Api>,
		context: Context,
		options?: ModelsSimpleStreamOptions,
	): Promise<AssistantMessage>;
}

export interface PiAiAdapterDependencies {
	createRuntime(): Promise<PiModelsClient>;
}

export type PiRequestAuth =
	| {
			ok: true;
			apiKey?: string;
			headers?: Record<string, string>;
			env?: Record<string, string>;
	  }
	| { ok: false; error: string };

export interface PiHostModelRegistry {
	getProvider(provider: string): Provider | undefined;
	getApiKeyAndHeaders(model: Model<Api>): Promise<PiRequestAuth>;
}

export interface PiHostModelContext {
	model: Model<Api> | undefined;
	modelRegistry: PiHostModelRegistry;
}
type CompleteMessage = (context: Context, signal?: AbortSignal) => Promise<AssistantMessage>;

const PI_CODING_AGENT_IMPORT = "@earendil-works/pi-coding-agent";

/**
 * Create an adapter for an explicitly selected provider/model using Pi's current ModelRuntime.
 * Returns undefined when configuration, the host package, runtime initialization, or the model is
 * unavailable.
 */
export async function tryCreatePiAiAdapter(
	opts?: Partial<PiAiAdapterOptions>,
	dependencies: Partial<PiAiAdapterDependencies> = {},
): Promise<ModelAdapter | undefined> {
	const provider = opts?.provider ?? process.env.PI_AI_PROVIDER;
	const modelId = opts?.model ?? process.env.PI_AI_MODEL;
	if (!provider || !modelId) return undefined;

	let runtime: PiModelsClient;
	try {
		runtime = await (dependencies.createRuntime ?? createDefaultRuntime)();
	} catch {
		return undefined;
	}

	const model = runtime.getModel(provider, modelId);
	if (!model) return undefined;
	return createPiModelAdapter(model, (context, signal) =>
		runtime.completeSimple(model, context, { signal }),
	);
}

/** Build an adapter around Pi's active model and authenticated provider. */
export function createPiHostModelAdapter(context: PiHostModelContext): ModelAdapter | undefined {
	const model = context.model;
	if (!model) return undefined;

	return createPiModelAdapter(model, async (requestContext, signal) => {
		const provider = context.modelRegistry.getProvider(model.provider);
		if (!provider) {
			throw new Error(`Pi provider "${model.provider}" is unavailable.`);
		}
		const auth = await context.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(auth.error);
		const stream = provider.streamSimple(model, requestContext, {
			signal,
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
		});
		return await stream.result();
	});
}

/** Convert a current Pi model completion function to the scraper's small model boundary. */
export function createPiModelAdapter(model: Model<Api>, complete: CompleteMessage): ModelAdapter {
	return {
		async run<T>(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse<T>> {
			throwIfAborted(signal);
			const message = await complete(buildContext(request), signal);
			assertSuccessfulMessage(message);
			const text = extractText(message);
			const data = request.task === "extract" ? (parseJsonOrText(text) as T) : (text as T);
			return {
				data,
				text,
				raw: message,
				usage: buildUsage(message, model),
			};
		},
	};
}

async function createDefaultRuntime(): Promise<PiModelsClient> {
	const imported: unknown = await import(PI_CODING_AGENT_IMPORT);
	if (!isRuntimeModule(imported)) {
		throw new Error("Pi ModelRuntime is unavailable.");
	}
	return await imported.ModelRuntime.create();
}

function isRuntimeModule(
	value: unknown,
): value is { ModelRuntime: { create(): Promise<PiModelsClient> } } {
	if (typeof value !== "object" || value === null || !("ModelRuntime" in value)) return false;
	const runtime = value.ModelRuntime;
	if (typeof runtime !== "function") return false;
	return "create" in runtime && typeof runtime.create === "function";
}

function buildContext(request: ModelRequest): Context {
	return {
		messages: [
			{
				role: "user",
				timestamp: Date.now(),
				content: [{ type: "text", text: buildPrompt(request) }],
			},
		],
	};
}

function buildPrompt(request: ModelRequest): string {
	if (request.task === "summarize") {
		return `${request.prompt ?? "Summarize this page."}\n\n${request.input}`;
	}
	const schemaPart = request.schema
		? `\nJSON schema or shape:\n${JSON.stringify(request.schema)}`
		: "";
	return [
		"Extract structured JSON from this page content.",
		request.prompt ? `Instructions: ${request.prompt}` : undefined,
		schemaPart || undefined,
		"Return only JSON.",
		"",
		request.input,
	]
		.filter(Boolean)
		.join("\n");
}

function assertSuccessfulMessage(message: AssistantMessage): void {
	if (message.stopReason === "aborted") {
		throw new DOMException(message.errorMessage ?? "Aborted", "AbortError");
	}
	if (message.stopReason === "error") {
		throw new Error(message.errorMessage ?? "Pi model request failed.");
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function extractText(message: AssistantMessage): string {
	return message.content
		.filter(
			(content): content is Extract<AssistantMessage["content"][number], { type: "text" }> =>
				content.type === "text",
		)
		.map((content) => content.text)
		.join("\n");
}

function parseJsonOrText(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function buildUsage(message: AssistantMessage, requestedModel: Model<Api>): ModelUsage {
	return {
		provider: `${message.provider}/${message.model}`,
		model: message.model || requestedModel.id,
		inputTokens: message.usage.input,
		outputTokens: message.usage.output,
		totalTokens: message.usage.totalTokens,
		costUSD: message.usage.cost.total,
	};
}
