/** @file Extract registry module. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { createHttpClient, type HttpClient } from "../../http/client.ts";
import { hasStructuredError } from "../../http/errors.ts";
import type { CommonRequestOptions, ExtractorCapability, SourceReference } from "../../types.ts";
import { capability } from "../vertical/capabilities.ts";
import type {
	VerticalExtractionResult,
	VerticalExtractor,
	VerticalExtractorContext,
	VerticalExtractorPage,
	VerticalExtractorProgress,
} from "../vertical/capabilities.ts";
import { parseManifestText } from "./loader.ts";
import type { ManifestRegistryEntry, ManifestRegistryOptions } from "./manifest-registry.ts";
import type { VerticalManifest } from "./manifest-types.ts";
import { matchManifestUrl } from "./matcher.ts";

export const verticalExtractors: readonly VerticalExtractor[] = [];

let readClientPromise: Promise<Pick<HttpClient, "fetchUrl">> | undefined;

/**
 * Lazily resolve a fingerprint (impit) client for GET reads so vertical API/page fetches carry a
 * browser-like TLS fingerprint and beat fingerprint-based blocks (e.g. Reddit 403). Falls back to
 * the plain undici client if the fingerprint backend is unavailable. POST stays on undici — the
 * fingerprint adapter is GET/HEAD-only and drops request bodies.
 */
function resolveReadClient(): Promise<Pick<HttpClient, "fetchUrl">> {
	readClientPromise ??= (async () => {
		try {
			const { getFingerprintFetchAdapter } = await import("../../http/fingerprint/index.ts");
			const adapter = getFingerprintFetchAdapter();
			return { fetchUrl: (url, options, signal) => adapter.fetch(url, options, signal) };
		} catch {
			return createHttpClient();
		}
	})();
	return readClientPromise;
}

const fingerprintReadClient: Pick<HttpClient, "fetchUrl"> = {
	fetchUrl: async (url, options, signal) =>
		await (await resolveReadClient()).fetchUrl(url, options, signal),
};

/**
 * Wrap a browser-backed in-page fetch (from openBrowserFetchSession) into the `fetchUrl` contract
 * so vertical fetches run inside the navigated browser page — carrying its cookies, fingerprint,
 * and JS-challenge pass. On in-page failure (e.g. a cross-origin API without CORS) it falls back to
 * the network clients: impit for GET/HEAD, undici otherwise. Pass the result as `deps.httpClient`
 * and httpContext routes every vertical fetch (GET + POST) through it.
 */
export function createBrowserReadClient(
	pageFetch: (
		req: { url: string; method?: string; headers?: Record<string, string>; body?: string },
		signal?: AbortSignal,
	) => Promise<{ status: number; text: string; finalUrl: string; contentType?: string }>,
): Pick<HttpClient, "fetchUrl"> {
	return {
		fetchUrl: async (input, options, signal) => {
			const url = input.toString();
			const method = options?.method ?? "GET";
			try {
				const body = typeof options?.body === "string" ? options.body : undefined;
				const result = await pageFetch({ url, method, headers: options?.headers, body }, signal);
				return {
					url,
					finalUrl: result.finalUrl || url,
					status: result.status,
					headers: result.contentType ? { "content-type": result.contentType } : {},
					contentType: result.contentType,
					text: result.text,
					downloadedBytes: Buffer.byteLength(result.text),
				};
			} catch {
				// In-page fetch failed (cross-origin without CORS, etc.) — fall back to the network clients.
				const fallback =
					method === "GET" || method === "HEAD" ? fingerprintReadClient : createHttpClient();
				return await fallback.fetchUrl(input, options, signal);
			}
		},
	};
}

export interface VerticalRegistryDeps {
	context?: VerticalExtractorContext;
	httpClient?: Pick<HttpClient, "fetchUrl">;
	prerenderedPage?: VerticalExtractorPage;
	requestOptions?: Pick<
		CommonRequestOptions,
		"cacheTtlSeconds" | "maxAgeSeconds" | "refresh" | "respectRobots"
	>;
	onProgress?(options: VerticalExtractorProgress): void | Promise<void>;
	manifestOptions?: ManifestRegistryOptions;
}

export function listExtractorCapabilities(): ExtractorCapability[] {
	const byName = new Map<string, ExtractorCapability>();
	for (const item of listPackageManifestCapabilities()) byName.set(item.name, item);
	for (const extractor of verticalExtractors)
		byName.set(extractor.capability.name, extractor.capability);
	return [...byName.values()];
}

let cachedPackageCapabilities: ExtractorCapability[] | undefined;

function listPackageManifestCapabilities(): ExtractorCapability[] {
	cachedPackageCapabilities ??= readPackageManifests().map((manifest) =>
		capability(manifest.name, manifest.urlPatterns, manifest.outputSchema ?? { type: "object" }, {
			requiresBrowser: manifest.requirements?.requiresBrowser ?? false,
			requiresLLM: manifest.requirements?.requiresLLM ?? false,
			requiresCloud: manifest.requirements?.requiresCloud ?? false,
		}),
	);
	return cachedPackageCapabilities;
}

function readPackageManifests(): VerticalManifest[] {
	const dir = path.resolve(import.meta.dirname, "../../../verticals");
	try {
		return readdirSync(dir)
			.filter((file) => isPackageManifestFile(file))
			.flatMap((file) => {
				const parsed = parseManifestText(readFileSync(path.join(dir, file), "utf8"), file);
				return isVerticalManifest(parsed) ? [parsed] : [];
			})
			.toSorted(
				(a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
			);
	} catch {
		// Package manifests are an optional packaged asset during tests/source checkouts.
		return [];
	}
}

function isPackageManifestFile(file: string): boolean {
	return (
		file.endsWith(".yaml") ||
		file.endsWith(".yml") ||
		file.endsWith(".jsonc") ||
		file.endsWith(".json")
	);
}

function isVerticalManifest(value: unknown): value is VerticalManifest {
	return typeof value === "object" && value !== null && "name" in value && "urlPatterns" in value;
}

/** Build the full manifest registry including built-in + user manifests. */
export async function buildManifestRegistry(options?: boolean | ManifestRegistryOptions) {
	const { buildManifestRegistry: build } = await import("./manifest-registry.ts");
	return await build(options ?? { includeProject: false });
}

export async function runVerticalExtractor<T = unknown>(
	name: string,
	input: string | URL,
	deps: VerticalRegistryDeps = {},
	signal?: AbortSignal,
): Promise<VerticalExtractionResult<T>> {
	const url = new URL(input.toString());

	// Check manifest registry first — user overrides take priority
	const manifestMod = await import("./manifest-registry.ts");
	const registry = await manifestMod.buildManifestRegistry(deps.manifestOptions);
	const entry = registry.get(name);
	if (entry?.isDeclarative) {
		const captures = matchManifestUrl(entry.manifest, url);
		if (captures) {
			return await runDeclarativeExtractor(entry, name, url, captures, deps, signal);
		}
	}

	// Fall back to built-in TypeScript extractors
	const extractor = verticalExtractors.find((candidate) => candidate.capability.name === name);
	if (extractor) {
		const match = extractor.match(url);
		if (match) {
			return await runBuiltinExtractor(extractor, name, url, match, deps, signal);
		}
	}

	if (!extractor && !entry) {
		return {
			extractor: name,
			url: url.toString(),
			error: {
				code: "EXTRACTOR_NOT_FOUND",
				message: `Unknown extractor: ${name}`,
				retryable: false,
			},
		};
	}
	return {
		extractor: name,
		url: url.toString(),
		error: {
			code: "URL_NOT_SUPPORTED",
			message: `${name} does not support this URL`,
			retryable: false,
		},
	};
}

async function runBuiltinExtractor<T>(
	extractor: VerticalExtractor,
	name: string,
	url: URL,
	match: Record<string, string>,
	deps: VerticalRegistryDeps,
	signal?: AbortSignal,
): Promise<VerticalExtractionResult<T>> {
	const sources: SourceReference[] = [];
	try {
		const data = await extractor.extract(
			url,
			match,
			deps.context ??
				httpContext(
					deps.httpClient,
					deps.requestOptions,
					sources,
					deps.onProgress ? (options) => deps.onProgress!(options) : undefined,
					deps.prerenderedPage,
				),
			signal,
		);
		return {
			extractor: name,
			url: url.toString(),
			data: data as T,
			sources: sources.length > 0 ? sources : undefined,
		};
	} catch (error) {
		return {
			extractor: name,
			url: url.toString(),
			sources: sources.length > 0 ? sources : undefined,
			error: verticalError(error),
		};
	}
}

async function runDeclarativeExtractor<T>(
	entry: ManifestRegistryEntry,
	name: string,
	url: URL,
	match: Record<string, string>,
	deps: VerticalRegistryDeps,
	signal?: AbortSignal,
): Promise<VerticalExtractionResult<T>> {
	const { createManifestExtractor } = await import("./extractor.ts");
	const extractor = createManifestExtractor(entry.manifest);
	const sources: SourceReference[] = [];
	try {
		const data = await extractor.extract(
			url,
			match,
			deps.context ??
				httpContext(
					deps.httpClient,
					deps.requestOptions,
					sources,
					deps.onProgress ? (options) => deps.onProgress!(options) : undefined,
					deps.prerenderedPage,
				),
			signal,
		);
		return {
			extractor: name,
			url: url.toString(),
			data: data as T,
			sources: sources.length > 0 ? sources : undefined,
		};
	} catch (error) {
		return {
			extractor: name,
			url: url.toString(),
			sources: sources.length > 0 ? sources : undefined,
			error: verticalError(error),
		};
	}
}

function verticalError(error: unknown): {
	code: string;
	message: string;
	retryable: boolean;
} {
	const structured = extractionStructuredError(error);
	if (structured) return structured;
	return {
		code: "EXTRACTION_FAILED",
		message: error instanceof Error ? error.message : "Vertical extraction failed",
		retryable: false,
	};
}

function extractionStructuredError(
	error: unknown,
): { code: string; message: string; retryable: boolean } | undefined {
	if (!hasStructuredError(error)) return;
	return {
		code: error.structured.code,
		message: error.structured.message,
		retryable: error.structured.retryable,
	};
}

function httpContext(
	client: Pick<HttpClient, "fetchUrl"> | undefined,
	requestOptions: Pick<
		CommonRequestOptions,
		"cacheTtlSeconds" | "maxAgeSeconds" | "refresh" | "respectRobots"
	> = {},
	sources: SourceReference[] = [],
	onProgress?: (options: VerticalExtractorProgress) => void | Promise<void>,
	prerenderedPage?: VerticalExtractorPage,
): VerticalExtractorContext {
	const writeClient = client ?? createHttpClient();
	const readClient = client ?? fingerprintReadClient;
	return {
		fetchJson: async <T>(url: string, signal?: AbortSignal) => {
			recordVerticalSource(sources, url, "api");
			const response = await readClient.fetchUrl(
				url,
				{
					...requestOptions,
					forceText: true,
					respectRobots: false,
					headers: { accept: "application/json" },
				},
				signal,
			);
			return JSON.parse(response.text ?? "null") as T;
		},
		fetchJsonPost: async <T>(url: string, body: unknown, signal?: AbortSignal) => {
			recordVerticalSource(sources, url, "api");
			const response = await writeClient.fetchUrl(
				url,
				{
					...requestOptions,
					method: "POST",
					body: JSON.stringify(body),
					forceText: true,
					respectRobots: false,
					headers: {
						accept: "application/json",
						"content-type": "application/json",
					},
				},
				signal,
			);
			return JSON.parse(response.text ?? "null") as T;
		},
		fetch: async (
			url: string,
			opts?: {
				method?: "GET" | "POST" | "PUT" | "DELETE";
				headers?: Record<string, string>;
				body?: string;
			},
			signal?: AbortSignal,
		) => {
			recordVerticalSource(sources, url, "api");
			const headers: Record<string, string> = {
				accept: "application/json",
				...opts?.headers,
			};
			if (opts?.body) headers["content-type"] = "application/json";
			const method = opts?.method ?? "GET";
			const response = await (method === "GET" ? readClient : writeClient).fetchUrl(
				url,
				{
					...requestOptions,
					method,
					body: opts?.body,
					forceText: true,
					respectRobots: false,
					headers,
				},
				signal,
			);
			return {
				data: JSON.parse(response.text ?? "null"),
				status: response.status,
			};
		},
		fetchText: async (url: string, signal?: AbortSignal) => {
			recordVerticalSource(sources, url, "feed");
			const response = await readClient.fetchUrl(
				url,
				{ ...requestOptions, forceText: true, respectRobots: false },
				signal,
			);
			return response.text ?? "";
		},
		fetchPage: async (url: string, signal?: AbortSignal) => {
			if (prerenderedPage && matchesPrerenderedPage(url, prerenderedPage)) {
				recordVerticalSource(sources, prerenderedPage.finalUrl, "page");
				return prerenderedPage;
			}
			recordVerticalSource(sources, url, "page");
			const response = await readClient.fetchUrl(
				url,
				{ ...requestOptions, forceText: true, respectRobots: requestOptions.respectRobots ?? true },
				signal,
			);
			return {
				text: response.text ?? response.body?.toString("utf8") ?? "",
				finalUrl: response.finalUrl,
				status: response.status,
				contentType: response.contentType,
			};
		},
		emitProgress: onProgress
			? async (options) => {
					try {
						await onProgress(options);
					} catch {
						/* progress is best-effort */
					}
				}
			: undefined,
	};
}

function matchesPrerenderedPage(url: string, page: VerticalExtractorPage): boolean {
	return sameUrl(url, page.requestedUrl) || sameUrl(url, page.finalUrl);
}

function sameUrl(left: string, right: string | undefined): boolean {
	if (!right) return false;
	try {
		return new URL(left).toString() === new URL(right).toString();
	} catch {
		return left === right;
	}
}

function recordVerticalSource(sources: SourceReference[], url: string, provider: string): void {
	if (sources.some((source) => source.url === url)) return;
	sources.push({
		id: `source-${sources.length + 1}`,
		url,
		provider,
		accessedAt: new Date().toISOString(),
	});
}
