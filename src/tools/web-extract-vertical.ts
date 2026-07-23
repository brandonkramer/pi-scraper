import { randomUUID } from "node:crypto";

import { loadEffectiveConfig } from "../config.ts";
import type {
	VerticalExtractionResult,
	VerticalExtractorPage,
} from "../extract/vertical/capabilities.ts";
import type {
	ManifestRegistry,
	ManifestRegistryOptions,
} from "../extract/vertical/manifest-registry.ts";
import type { ManifestDiagnostic } from "../extract/vertical/manifest-types.ts";
import { matchManifestUrl } from "../extract/vertical/matcher.ts";
import type {
	createBrowserReadClient as createBrowserReadClientFn,
	listExtractorCapabilities as listExtractorCapabilitiesFn,
	runVerticalExtractor as runVerticalExtractorFn,
} from "../extract/vertical/registry.ts";
import type { HttpClient } from "../http/client.ts";
import type { ExtractorCapability } from "../types.ts";
/**
 * @file Web_extract action="vertical" and action="list" handlers — deterministic extractor
 *   capabilities and vertical extraction.
 */
import type { ToolExecutionContext, ToolUpdate } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { inputErrorResult, toolResult } from "./infra/result.ts";
import type { Params, WebExtractToolOptions } from "./web-extract.ts";

interface VerticalBrowserFallbackMetadata {
	browserFallback?: {
		used: boolean;
		backend: string;
	};
}

type VerticalResultWithMetadata = VerticalExtractionResult & VerticalBrowserFallbackMetadata;
type VerticalRegistryModule = {
	createBrowserReadClient: typeof createBrowserReadClientFn;
	listExtractorCapabilities: typeof listExtractorCapabilitiesFn;
	runVerticalExtractor: typeof runVerticalExtractorFn;
	buildManifestRegistry: (options?: boolean | ManifestRegistryOptions) => Promise<ManifestRegistry>;
};

let verticalRegistryPromise: Promise<VerticalRegistryModule> | undefined;

function loadVerticalRegistry(): Promise<VerticalRegistryModule> {
	verticalRegistryPromise ??= import("../extract/vertical/registry.ts");
	return verticalRegistryPromise;
}

export async function listDeterministicExtractors(context?: ToolExecutionContext) {
	const { listExtractorCapabilities, buildManifestRegistry } = await loadVerticalRegistry();
	const capabilities = listExtractorCapabilities();
	const registry = await buildManifestRegistry(manifestOptions(context));
	const { listManifestExtractors } = await import("../extract/vertical/manifest-registry.ts");
	const manifestItems = listManifestExtractors(registry);
	const merged = manifestItems.map((item) => {
		const cap = capabilities.find((c: ExtractorCapability) => c.name === item.name);
		return {
			...item,
			requiresBrowser: cap?.requiresBrowser ?? item.requirements?.requiresBrowser ?? false,
			requiresLLM: cap?.requiresLLM ?? item.requirements?.requiresLLM ?? false,
			requiresCloud: cap?.requiresCloud ?? item.requirements?.requiresCloud ?? false,
		};
	});
	const diagnostics =
		registry.errors.length > 0
			? `\nDiagnostics: ${registry.errors.map((e: ManifestDiagnostic) => e.message).join("; ")}`
			: "";
	return toolResult({
		text: `${merged.length} extractor(s):\n${merged
			.map((item) => {
				const patterns =
					item.urlPatterns.length > 0
						? `  [${item.urlPatterns.join(", ")}]`
						: "  [content-based, no URL]";
				const desc = item.description ? ` — ${item.description}` : "";
				return `- ${item.name}${desc}\n  ${patterns}`;
			})
			.join("\n")}${diagnostics}`,
		data: merged,
		format: "json",
		summary: `Listed ${merged.length} deterministic extractor capabilities.`,
		assistantGuidance:
			"The list above shows each extractor's declared URL patterns. Use action=vertical with extractor=<name> only when the target URL matches the corresponding pattern — the extractor hits that site's structured API rather than scraping HTML. If the URL doesn't match any pattern, use web_scrape instead. Extractors marked [content-based, no URL] expect raw content via the content parameter, not a URL. For all other extraction (regex, selectors, excerpts, schema) use action=pattern or action=adhoc.",
	});
}

export async function runDeterministicExtractor(
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
	context?: ToolExecutionContext,
) {
	if (!params.extractor || !params.url) {
		return inputErrorResult(
			"EXTRACT_INPUT_MISSING",
			"vertical_extract",
			"web_extract action=vertical requires both extractor and url.",
			"Provide extractor and url for vertical extraction.",
		);
	}
	const extractor: string = params.extractor;
	const url: string = params.url;
	const registryOptions = manifestOptions(context);
	const mismatch = await suggestExtractorForUrl(extractor, url, registryOptions);
	if (mismatch) return mismatch;
	const effectiveParams = await resolveVerticalBrowserParams(params, extractor);
	const config = await loadEffectiveConfig();
	await emitProgress(onUpdate, {
		state: "processing",
		url,
		message: `extractor ${extractor}`,
	});
	const browser = await maybeOpenVerticalBrowser(url, effectiveParams, options, signal, onUpdate);
	try {
		const { runVerticalExtractor } = await loadVerticalRegistry();
		const result = await runVerticalExtractor(
			extractor,
			url,
			{
				prerenderedPage: browser?.prerenderedPage,
				httpClient: browser?.client,
				requestOptions: {
					cacheTtlSeconds: config.scrapeDefaults.cacheTtlSeconds,
					maxAgeSeconds: config.scrapeDefaults.maxAgeSeconds,
					refresh: config.scrapeDefaults.refresh,
					respectRobots: params.respectRobots,
				},
				manifestOptions: registryOptions,
				onProgress: onUpdate
					? (progress) =>
							emitProgress(onUpdate, {
								state: progress.state as "waiting" | "loading" | "processing" | "done" | "error",
								message: progress.message,
								url: progress.url,
							})
					: undefined,
			},
			signal,
		);
		const resultWithMetadata: VerticalResultWithMetadata = browser
			? {
					...result,
					browserFallback: {
						used: true,
						backend: effectiveParams.browserBackend ?? "cloak",
					},
				}
			: result;
		return toolResult({
			text: verticalExtractorText(extractor, resultWithMetadata),
			data: resultWithMetadata,
			url,
			format: "json",
			sources: result.sources,
			summary: verticalExtractorSummary(extractor, resultWithMetadata),
			error: result.error && {
				...result.error,
				phase: "vertical_extract",
				url,
			},
			assistantGuidance: verticalExtractorGuidance(resultWithMetadata),
		});
	} finally {
		await browser?.close();
	}
}

/**
 * Guard against the agent pairing an extractor with a URL it cannot handle (e.g. extractor:"reddit"
 * with a subreddit listing URL, which belongs to reddit_listing). Runs before browser escalation so
 * a mismatch never pays for a cloaked-browser navigation. Only suggests a sibling that matches the
 * URL on a _literal_ host, so greedy wildcard-host manifests (e.g. gitlab's
 * https://:host/:owner/:repo) can't claim unrelated URLs; anything else falls through to the normal
 * not-found/unsupported errors.
 */
async function suggestExtractorForUrl(
	extractor: string,
	url: string,
	options: ManifestRegistryOptions,
) {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	const { buildManifestRegistry } = await loadVerticalRegistry();
	const registry = await buildManifestRegistry(options);
	const requested = registry.get(extractor);
	if (requested && matchManifestUrl(requested.manifest, parsed)) return;
	const host = parsed.hostname.toLowerCase();
	const alt = registry.entries.find(
		(entry) =>
			entry.manifest.name !== extractor &&
			manifestLiteralHosts(entry.manifest).has(host) &&
			matchManifestUrl(entry.manifest, parsed),
	);
	if (!alt) return;
	const patterns = alt.manifest.urlPatterns.join(", ");
	return inputErrorResult(
		"EXTRACTOR_URL_MISMATCH",
		"vertical_extract",
		`extractor="${extractor}" does not match this URL. Use extractor="${alt.manifest.name}" — it matches: ${patterns}`,
	);
}

function manifestOptions(context?: ToolExecutionContext): ManifestRegistryOptions {
	return {
		includeProject: true,
		cwd: context?.cwd ?? process.cwd(),
		projectTrusted: context?.isProjectTrusted?.() ?? false,
	};
}

/**
 * Concrete (non-wildcard) hosts a manifest's patterns pin to, for high-confidence sibling
 * suggestions.
 */
function manifestLiteralHosts(manifest: { urlPatterns: string[] }): Set<string> {
	const hosts = new Set<string>();
	for (const pattern of manifest.urlPatterns) {
		const host = pattern.replace(/^https?:\/\//u, "").split("/")[0] ?? "";
		if (host && !host.includes(":") && !host.includes("*")) hosts.add(host.toLowerCase());
	}
	return hosts;
}

interface VerticalBrowserSession {
	prerenderedPage: VerticalExtractorPage;
	client: Pick<HttpClient, "fetchUrl">;
	close(): Promise<void>;
}

/**
 * Manifests declaring requirements.requiresBrowser:true (e.g. Reddit, which 403s plain HTTP)
 * escalate to mode:"browser" + cloak backend — but only when the caller did not pick a mode, so
 * explicit overrides like mode:"fingerprint" still opt out. Vertical-agnostic: any blocked vertical
 * opts in via its manifest, no per-name branching here.
 */
async function resolveVerticalBrowserParams(params: Params, extractor: string): Promise<Params> {
	if (params.mode !== undefined) return params;
	const { listExtractorCapabilities } = await loadVerticalRegistry();
	const requiresBrowser =
		listExtractorCapabilities().find((cap) => cap.name === extractor)?.requiresBrowser ?? false;
	if (!requiresBrowser) return params;
	// ponytail: backend pinned to cloak (Reddit's wall needs it); add a manifest backend field if a vertical needs playwright.
	return { ...params, mode: "browser", browserBackend: params.browserBackend ?? "cloak" };
}

/**
 * For mode:"browser", open one browser session and navigate to the vertical URL so the page carries
 * cookies + the JS-challenge pass, then return a browser-backed fetch client + the rendered page.
 * Vertical API/page fetches run via in-page fetch() and beat fingerprint/JS blocks (e.g. Reddit
 * 403). Propagates if the browser backend is unavailable — mode:"browser" is an explicit request
 * for it.
 */
async function maybeOpenVerticalBrowser(
	url: string,
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
): Promise<VerticalBrowserSession | undefined> {
	if (params.mode !== "browser") return;
	await emitProgress(onUpdate, {
		state: "loading",
		message: "opening browser session for vertical fetch",
	});
	const openBrowserFetchSession =
		options.openBrowserFetchSession ??
		(await import("../browser/playwright.ts")).openBrowserFetchSession;
	const { createBrowserReadClient } = await loadVerticalRegistry();
	// ponytail: per-call ephemeral session so close() can safely destroy it; wire params.sessionId reuse if auth needed.
	const session = await openBrowserFetchSession(
		{ url, sessionId: `vertical-${randomUUID()}`, browserBackend: params.browserBackend },
		signal,
	);
	const { rendered } = session;
	return {
		prerenderedPage: {
			requestedUrl: url,
			finalUrl: rendered.finalUrl,
			status: rendered.status ?? 200,
			text: rendered.html,
			html: rendered.html,
		},
		client: createBrowserReadClient((req, sig) => session.pageFetch(req, sig)),
		close: () => session.close(),
	};
}

function browserFallbackLabel(
	fallback: VerticalBrowserFallbackMetadata["browserFallback"] | undefined,
): string | undefined {
	return fallback?.used ? `browser fallback · ${fallback.backend}` : undefined;
}

/** Plain-text summary for the call result line (theme applied by renderResult). */
function verticalExtractorSummary(
	extractor: string | undefined,
	result: VerticalResultWithMetadata,
): string {
	const name = extractor ?? result.extractor;
	const blocked = blockedSource(result.data);
	if (blocked) {
		return `${name} returned URL metadata only (${blocked.reason ?? ""})`;
	}
	if (result.error) {
		const detail = [result.error.code, result.error.message].filter(Boolean).join(" \u00B7 ");
		return `\u2514\u2500 \u2715 ${name} failed \u00B7 ${detail}`;
	}
	const [metaLine] = extractorPreview(result.data);
	const details = [metaLine, browserFallbackLabel(result.browserFallback)]
		.filter(Boolean)
		.join(" \u00B7 ");
	return `\u2514\u2500 \u2713 ${name} done \u00B7 ${details}`;
}

/** Plain-text answer context (theme applied by renderResult). */
function verticalExtractorText(
	extractor: string | undefined,
	result: VerticalResultWithMetadata,
): string {
	const name = extractor ?? result.extractor;
	const blocked = blockedSource(result.data);
	if (blocked) {
		return [
			`${name} returned URL metadata only (${blocked.reason ?? "structured endpoint unavailable"})`,
			attemptedText(blocked.attemptedEndpoints ?? result.sources?.map((source) => source.url)),
		]
			.filter(Boolean)
			.join("\n");
	}
	if (result.error) {
		return [
			`\u2514\u2500 \u2715 ${name} failed \u00B7 ${result.error.code}${result.error.message ? ` \u00B7 ${result.error.message}` : ""}`,
			attemptedText(result.sources?.map((source) => source.url)),
		]
			.filter(Boolean)
			.join("\n");
	}
	const [metaLine] = extractorPreview(result.data);
	const details = [metaLine, browserFallbackLabel(result.browserFallback)]
		.filter(Boolean)
		.join(" \u00B7 ");
	const treePrefix = `\u2514\u2500 \u2713 ${name} done`;

	// Include full transcript text (up to 2000 chars) in the answer context
	const data = result.data as Record<string, unknown> | undefined;
	const transcript = data?.transcript as { text?: string } | undefined;
	if (transcript?.text) {
		const text = transcript.text.replaceAll(/\s+/gu, " ").trim();
		const snippet = text.length > 2000 ? text.slice(0, 2000) + "\u2026" : text;
		return `${treePrefix} \u00B7 ${details}\n\u2502 ${snippet}`;
	}

	return `${treePrefix} \u00B7 ${details}`;
}

/**
 * Build a compact inline preview from common vertical data fields. Returns [metaLine: string,
 * transcriptSnippet?: string].
 */
function extractorPreview(data: unknown): [string, string | undefined] {
	const d = data as Record<string, unknown> | undefined;
	if (!d) return ["extracted JSON", undefined];

	const parts: string[] = [];

	// Title (used by youtube, npm, github, reddit, most verticals)
	if (typeof d.title === "string" && d.title) parts.push(d.title);

	// Views (youtube, stackoverflow, etc.)
	if (typeof d.viewCount === "number" && d.viewCount > 0) {
		parts.push(`${d.viewCount.toLocaleString()} views`);
	} else if (typeof d.views === "number" && d.views > 0) {
		parts.push(`${(d.views / 1000000).toFixed(d.views >= 100000000 ? 0 : 1)}M views`);
	} else if (typeof d.views === "string" && d.views) {
		parts.push(`${d.views} views`);
	}

	// Answers (stackoverflow)
	const answers = d.answers;
	if (Array.isArray(answers) && answers.length > 0) {
		parts.push(`${answers.length} answers`);
	}

	// Transcript preview (youtube)
	const transcript = d.transcript as { text?: string; segments?: unknown[] } | undefined;
	if (transcript?.segments) {
		parts.push(`${transcript.segments.length} segments`);
	}
	if (transcript?.text) {
		const text = transcript.text.replaceAll(/\s+/gu, " ").trim();
		const snippet = text.length > 120 ? text.slice(0, 120) + "\u2026" : text;
		return [parts.join(" \u00B7 "), snippet];
	}

	// Description preview fallback (any vertical)
	if (typeof d.description === "string" && d.description) {
		const desc = d.description.replaceAll(/\s+/gu, " ").trim();
		const snippet = desc.length > 120 ? desc.slice(0, 120) + "\u2026" : desc;
		parts.push(snippet);
	}

	// Comments count (youtube, reddit)
	const comments = d.comments;
	if (Array.isArray(comments) && comments.length > 0) {
		parts.push(`${comments.length} comments`);
	}

	// Transcript tracks (youtube)
	const tracks = d.transcriptTracks;
	if (Array.isArray(tracks) && tracks.length > 1) {
		parts.push(`${tracks.length} languages`);
	}

	return [parts.length > 0 ? parts.join(" \u00B7 ") : "extracted JSON", undefined];
}

function verticalExtractorGuidance(result: VerticalExtractionResult): string | undefined {
	const blocked = blockedSource(result.data);
	if (blocked?.reason) return blocked.reason;
	return result.error?.message;
}

function attemptedText(urls: string[] | undefined): string | undefined {
	const uniqueUrls = [...new Set(urls?.filter(Boolean) ?? [])];
	return uniqueUrls.length > 0 ? `attempted:\n  - ${uniqueUrls.join("\n  - ")}` : undefined;
}

function blockedSource(
	data: unknown,
): { blocked?: boolean; reason?: string; attemptedEndpoints?: string[] } | undefined {
	const source = (data as { source?: unknown } | undefined)?.source;
	if (!source || typeof source !== "object") return;
	const typed = source as {
		blocked?: boolean;
		reason?: string;
		attemptedEndpoints?: string[];
	};
	return typed.blocked ? typed : undefined;
}
