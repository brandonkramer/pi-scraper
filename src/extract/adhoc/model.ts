/**
 * @fileoverview extract model module.
 */
export interface ModelRequest {
  task: "extract" | "summarize";
  input: string;
  prompt?: string;
  schema?: unknown;
  options?: Record<string, unknown>;
}

export interface ModelUsage {
  /** Human-readable provider/adapter identifier. */
  provider?: string;
  /** Underlying model name, e.g. "gemini-2.0-flash". */
  model?: string;
  /** Input/prompt tokens consumed. */
  inputTokens?: number;
  /** Output/completion tokens generated. */
  outputTokens?: number;
  /** Convenience; may be supplied by adapter or computed from in+out. */
  totalTokens?: number;
  /** Cost in USD. Adapter computes from its own pricing. */
  costUSD?: number;
}

export interface ModelResponse<T = unknown> {
  data: T;
  text?: string;
  raw?: unknown;
  usage?: ModelUsage;
}

export interface ModelAdapter {
  run<T = unknown>(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse<T>>;
}

export class MissingModelAdapterError extends Error {
  constructor(readonly task: string) {
    super(`No model adapter configured for ${task}`);
    this.name = "MissingModelAdapterError";
  }
}
