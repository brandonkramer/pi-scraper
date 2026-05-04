import type {
	OutputFormat,
	PiToolShell,
	ResultEnvelope,
	StructuredError,
	TimingInfo,
} from "../types.js";

export interface ResultShellOptions<TData> {
	text: string;
	data: TData;
	url?: string;
	finalUrl?: string;
	status?: number;
	mode?: string;
	format?: OutputFormat | string;
	contentType?: string;
	downloadedBytes?: number;
	cache?: ResultEnvelope<TData>["cache"];
	responseId?: string;
	fullOutputPath?: string;
	truncated?: boolean;
	sources?: ResultEnvelope<TData>["sources"];
	citations?: ResultEnvelope<TData>["citations"];
	error?: StructuredError;
	timing?: Partial<TimingInfo>;
}

export function toolResult<TData>(
	options: ResultShellOptions<TData>,
): PiToolShell<ResultEnvelope<TData>> {
	return {
		content: [{ type: "text", text: options.text }],
		details: {
			url: options.url,
			finalUrl: options.finalUrl,
			status: options.status,
			mode: options.mode,
			format: options.format,
			timing: withTiming(options.timing),
			truncated: options.truncated ?? false,
			fullOutputPath: options.fullOutputPath,
			responseId: options.responseId,
			data: options.data,
			contentType: options.contentType,
			downloadedBytes: options.downloadedBytes,
			cache: options.cache,
			sources: options.sources,
			citations: options.citations,
			error: options.error,
		},
	};
}

export function errorResult(
	error: StructuredError,
	text = error.message,
): PiToolShell<ResultEnvelope<undefined>> {
	return toolResult({
		text,
		data: undefined,
		url: error.url,
		finalUrl: error.finalUrl,
		status: error.statusCode,
		error,
		truncated: false,
	});
}

export function structuredToolError(
	error: unknown,
	fallbackCode: string,
	phase: string,
	url?: string,
): StructuredError {
	if (typeof error === "object" && error !== null && "structured" in error) {
		return (error as { structured: StructuredError }).structured;
	}
	return {
		code: fallbackCode,
		phase,
		message: error instanceof Error ? error.message : "Tool execution failed",
		retryable: false,
		url,
		cause: error,
	};
}

export function missingModelError(
	task: "extract" | "summarize",
	url?: string,
): StructuredError {
	return {
		code: "MODEL_ADAPTER_MISSING",
		phase: task,
		message: `${task} requires Pi model/LLM execution, but this tool adapter has no model adapter configured yet. Use scrape output directly or configure a model-backed adapter when available.`,
		retryable: false,
		url,
	};
}

function withTiming(timing: Partial<TimingInfo> = {}): TimingInfo {
	const startedAt = timing.startedAt ?? new Date().toISOString();
	return { startedAt, ...timing };
}
