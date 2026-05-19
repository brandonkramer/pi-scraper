import type { ModelUsage } from "../../extract/adhoc/model.ts";
import { structuredErrorFromUnknown } from "../../http/errors.ts";
import { freshnessFromCache, guidanceWithFreshness } from "../../storage/cache/freshness.ts";
/** @file Tools result module. */
import type {
	OutputFormat,
	PiToolShell,
	ResultEnvelope,
	StructuredError,
	TimingInfo,
} from "../../types.ts";

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
	freshness?: ResultEnvelope<TData>["freshness"];
	responseId?: string;
	fullOutputPath?: string;
	truncated?: boolean;
	sources?: ResultEnvelope<TData>["sources"];
	citations?: ResultEnvelope<TData>["citations"];
	summary?: string;
	answerContext?: string;
	modelUsage?: ModelUsage;
	sourceNotes?: ResultEnvelope<TData>["sourceNotes"];
	qualitySignals?: ResultEnvelope<TData>["qualitySignals"];
	nextActions?: ResultEnvelope<TData>["nextActions"];
	assistantGuidance?: string;
	kind?: "scrape" | "diff";
	snapshotSaved?: { name: string; tag?: string; path: string };
	savedFilePath?: string;
	diagnostics?: Record<string, unknown>;
	error?: StructuredError;
	timing?: Partial<TimingInfo>;
}

export function toolResult<TData>(
	options: ResultShellOptions<TData>,
): PiToolShell<ResultEnvelope<TData>> {
	const freshness = options.freshness ?? freshnessFromCache(options.cache);
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
			freshness,
			sources: options.sources,
			citations: options.citations,
			summary: options.summary,
			answerContext: options.answerContext,
			modelUsage: options.modelUsage,
			sourceNotes: options.sourceNotes,
			qualitySignals: options.qualitySignals,
			nextActions: options.nextActions,
			assistantGuidance: guidanceWithFreshness(options.assistantGuidance, freshness),
			kind: options.kind,
			snapshotSaved: options.snapshotSaved,
			diagnostics: options.diagnostics,
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
	return structuredErrorFromUnknown(error, {
		code: fallbackCode,
		phase,
		message: "Tool execution failed",
		url,
	});
}

export function inputErrorResult(
	code: string,
	phase: string,
	message: string,
	text = message,
): PiToolShell<ResultEnvelope<undefined>> {
	return toolResult({
		text,
		data: undefined,
		error: { code, phase, message, retryable: false },
		truncated: false,
	});
}

export function missingModelResult(
	task: "extract" | "summarize",
	url: string | undefined,
	text: string,
): PiToolShell<ResultEnvelope<undefined>> {
	return errorResult(missingModelError(task, url), text);
}

export function toolErrorResult(
	error: unknown,
	fallbackCode: string,
	phase: string,
	url?: string,
): PiToolShell<ResultEnvelope<undefined>> {
	return errorResult(structuredToolError(error, fallbackCode, phase, url));
}

export function missingModelError(task: "extract" | "summarize", url?: string): StructuredError {
	return {
		code: "MODEL_ADAPTER_MISSING",
		phase: task,
		message: `${task} requires Pi model/LLM execution, but this tool adapter has no model adapter configured yet. Use scrape output directly or configure a model-backed adapter when available.`,
		retryable: false,
		url,
	};
}

export function adapterNotFoundError(
	task: "extract" | "summarize",
	requestedId: string,
	registeredIds: readonly string[],
	url?: string,
): StructuredError {
	return {
		code: "MODEL_ADAPTER_NOT_FOUND",
		phase: task,
		message: `Model adapter "${requestedId}" is not registered. Registered adapters: ${registeredIds.join(", ") || "none"}.`,
		retryable: false,
		url,
	};
}

export function adapterIncompatibleError(
	task: "extract" | "summarize",
	requestedId: string,
	url?: string,
): StructuredError {
	return {
		code: "MODEL_ADAPTER_INCOMPATIBLE",
		phase: task,
		message: `Model adapter "${requestedId}" does not support ${task}.`,
		retryable: false,
		url,
	};
}

function withTiming(timing: Partial<TimingInfo> = {}): TimingInfo {
	const startedAt = timing.startedAt ?? new Date().toISOString();
	return { startedAt, ...timing };
}
