/**
 * @file Peer-optional pi-ai fallback adapter. Lazily imports @earendil-works/pi-ai and builds a
 *   ModelAdapter from env/config-pinned provider + model. Only active when the package is installed
 *   AND both PI_AI_PROVIDER and PI_AI_MODEL are set.
 */
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

/** Narrow type covering the pi-ai functions we need at runtime. */
interface PiAiModule {
	getModel(provider: string, model: string): unknown;
	completeSimple(
		model: unknown,
		context: unknown,
	): Promise<{ content?: unknown[]; usage?: object }>;
	calculateCost(model: unknown, _usage: unknown): { total?: number } | undefined;
}

/**
 * Try to create a pi-ai ModelAdapter. Returns undefined when: - pi-ai is not installed (import
 * throws) - provider or model is missing - provider/model is not recognized by pi-ai (getModel
 * returns undefined)
 */
export async function tryCreatePiAiAdapter(
	opts?: Partial<PiAiAdapterOptions>,
): Promise<ModelAdapter | undefined> {
	const provider = opts?.provider ?? process.env.PI_AI_PROVIDER;
	const modelId = opts?.model ?? process.env.PI_AI_MODEL;
	if (!provider || !modelId) return undefined;

	let piAi: PiAiModule;
	try {
		piAi = (await import("@earendil-works/pi-ai")) as unknown as PiAiModule;
	} catch {
		return undefined;
	}

	// oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime env values may be unrecognized
	const resolvedModel = piAi.getModel(provider, modelId);
	if (!resolvedModel) return undefined;

	const label = `${provider}/${modelId}`;

	return {
		async run<T>(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse<T>> {
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

			const prompt = buildPrompt(request);

			// pi-ai's Context type is not re-exported; construct a duck-typed object
			// that matches the expected shape at runtime.
			const ctx: unknown = {
				messages: [
					{
						role: "user",
						timestamp: Date.now(),
						content: [{ type: "text", text: prompt }],
					},
				],
			};

			// Race the LLM call against the abort signal
			const message = await Promise.race([
				piAi.completeSimple(resolvedModel, ctx),
				abortSignalRace(signal),
			]);

			const text = extractText(message);
			const data = request.task === "extract" ? (parseJsonOrText(text) as T) : (text as T);
			const usage = buildUsage(piAi, resolvedModel, message, provider, modelId, label);
			return { data, text, raw: message as unknown, usage };
		},
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

function extractText(message: { content?: unknown[] }): string {
	if (!message.content) return "";
	return (message.content as Array<Record<string, unknown>>)
		.filter(
			(c): c is { type: string; text: string } => c.type === "text" && typeof c.text === "string",
		)
		.map((c) => c.text)
		.join("\n");
}

function parseJsonOrText(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function buildUsage(
	piAi: PiAiModule,
	model: unknown,
	message: { usage?: object },
	provider: string,
	modelId: string,
	label: string,
): ModelUsage {
	const usage: ModelUsage = {
		provider: label,
		model: modelId,
	};
	const msgUsage = message.usage as Record<string, unknown> | undefined;
	if (msgUsage) {
		usage.inputTokens = msgUsage.input as number | undefined;
		usage.outputTokens = msgUsage.output as number | undefined;
		usage.totalTokens = msgUsage.totalTokens as number | undefined;
		try {
			const cost = piAi.calculateCost(model, msgUsage);
			if (cost && typeof cost.total === "number") {
				usage.costUSD = cost.total;
			}
		} catch {
			// Cost calculation is best-effort
		}
	}
	return usage;
}

/**
 * Return a promise that never resolves — rejects with AbortError when the signal fires. Ensures the
 * race above doesn't race against undefined.
 */
function abortSignalRace(signal?: AbortSignal): Promise<never> {
	return new Promise((_resolve, reject) => {
		if (!signal) {
			// Never settle if no signal — the other branch must win
			return;
		}
		if (signal.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(new DOMException("Aborted", "AbortError"));
		};
		signal.addEventListener("abort", onAbort);
	});
}
