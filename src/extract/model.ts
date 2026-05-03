export interface ModelRequest {
  task: "extract" | "summarize";
  input: string;
  prompt?: string;
  schema?: unknown;
  options?: Record<string, unknown>;
}

export interface ModelResponse<T = unknown> {
  data: T;
  text?: string;
  raw?: unknown;
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
