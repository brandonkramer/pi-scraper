export type ScrapeMode = "fast" | "fingerprint" | "readable" | "browser" | "auto";

export type OutputFormat = "markdown" | "text" | "llm" | "html" | "json";

export type ProgressState =
  | "queued"
  | "connecting"
  | "waiting"
  | "loading"
  | "processing"
  | "done"
  | "error";

export type ToolRequirement = "local" | "browser" | "cloud" | "llm";

export interface PiTextContent {
  type: "text";
  text: string;
}

export interface PiToolShell<TDetails = unknown> {
  content: PiTextContent[];
  details: TDetails;
}

export interface TimingInfo {
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  fetchMs?: number;
  parseMs?: number;
  queueMs?: number;
}

export interface StructuredError {
  code: string;
  phase: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
  statusText?: string;
  downloadedBytes?: number;
  timeoutMs?: number;
  url?: string;
  finalUrl?: string;
  cause?: unknown;
}

export interface SourceReference {
  id?: string;
  title?: string;
  url: string;
  finalUrl?: string;
  provider?: string;
  snippet?: string;
  accessedAt?: string;
}

export interface Citation {
  sourceId?: string;
  url?: string;
  title?: string;
  text?: string;
  startOffset?: number;
  endOffset?: number;
}

export interface ResponseStorageMetadata {
  responseId: string;
  fullOutputPath: string;
  storedAt: string;
  byteLength?: number;
  lineCount?: number;
  contentType?: string;
}

export interface ResultEnvelope<TData = unknown> {
  /** Normalized original request URL after URL policy canonicalization, not the verbatim user input. */
  url?: string;
  /** Final normalized URL after redirects or provider canonicalization, when it differs or is known. */
  finalUrl?: string;
  status?: number;
  mode?: ScrapeMode | string;
  format?: OutputFormat | string;
  timing: TimingInfo;
  truncated: boolean;
  fullOutputPath?: string;
  responseId?: string;
  data: TData;
  contentType?: string;
  downloadedBytes?: number;
  sources?: SourceReference[];
  citations?: Citation[];
  error?: StructuredError;
}

export interface ProgressDetails<TData = unknown> {
  _progress: true;
  state: ProgressState;
  message?: string;
  url?: string;
  current?: number;
  total?: number;
  timing?: Partial<TimingInfo>;
  data?: TData;
}

export interface CommonRequestOptions {
  timeoutSeconds?: number;
  maxBytes?: number;
  maxChars?: number;
  headers?: Record<string, string>;
  proxy?: string;
  respectRobots?: boolean;
}

export interface CommonScrapeOptions extends CommonRequestOptions {
  mode?: ScrapeMode;
  format?: OutputFormat;
  include?: string[];
  exclude?: string[];
  onlyMainContent?: boolean;
  removeImages?: boolean;
  cookies?: Record<string, string>;
  browserProfile?: string;
  osProfile?: string;
}

export interface CommonMultiUrlOptions extends CommonRequestOptions {
  concurrency?: number;
  include?: string[];
  exclude?: string[];
}

export interface ExtractorCapability {
  name: string;
  urlPatterns: string[];
  requiresBrowser: boolean;
  requiresLLM: boolean;
  requiresCloud: boolean;
  schema: unknown;
  requirements?: ToolRequirement[];
}
