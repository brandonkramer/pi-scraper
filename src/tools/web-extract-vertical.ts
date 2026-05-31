import { loadEffectiveConfig } from "../config.ts";
import type {
	VerticalExtractionResult,
	VerticalExtractorPage,
} from "../extract/vertical/capabilities.ts";
import type {
	listExtractorCapabilities as listExtractorCapabilitiesFn,
	runVerticalExtractor as runVerticalExtractorFn,
} from "../extract/vertical/registry.ts";
import { scrapeUrl, type ScrapePipelineDeps } from "../scrape/pipeline.ts";
/**
 * @file Web_extract action="vertical" and action="list" handlers — deterministic extractor
 *   capabilities and vertical extraction.
 */
import type { ToolUpdate } from "./infra/define.ts";
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
	listExtractorCapabilities: typeof listExtractorCapabilitiesFn;
	runVerticalExtractor: typeof runVerticalExtractorFn;
};

let verticalRegistryPromise: Promise<VerticalRegistryModule> | undefined;

function loadVerticalRegistry(): Promise<VerticalRegistryModule> {
	verticalRegistryPromise ??= import("../extract/vertical/registry.ts");
	return verticalRegistryPromise;
}

export async function listDeterministicExtractors() {
	const { listExtractorCapabilities } = await loadVerticalRegistry();
	const capabilities = listExtractorCapabilities();
	return toolResult({
		text: `${capabilities.length} extractor(s): ${capabilities.map((item) => item.name).join(", ")}`,
		data: capabilities,
		format: "json",
		summary: "Listed deterministic extractor capabilities.",
		assistantGuidance:
			"Use action=vertical with extractor=<name> for supported known sites. GitHub: use extractor=github_repo for API metadata/README/tree or extractor=gitingest for an LLM-ready codebase digest. Hugging Face: extractor=huggingface_model accepts /owner/model and legacy /model; extractor=huggingface_dataset accepts /datasets/owner/dataset and legacy /datasets/dataset. Use action=pattern for deterministic markers/regex/excerpts and action=adhoc for model-backed schema extraction.",
	});
}

export async function runDeterministicExtractor(
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
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
	const config = await loadEffectiveConfig();
	await emitProgress(onUpdate, {
		state: "processing",
		url,
		message: `extractor ${extractor}`,
	});
	const prerenderedPage = await maybePrerenderVerticalPage(
		url,
		params,
		options.scrapeDeps,
		signal,
		onUpdate,
	);
	const { runVerticalExtractor } = await loadVerticalRegistry();
	const result = await runVerticalExtractor(
		extractor,
		url,
		{
			prerenderedPage,
			requestOptions: {
				cacheTtlSeconds: config.scrapeDefaults.cacheTtlSeconds,
				maxAgeSeconds: config.scrapeDefaults.maxAgeSeconds,
				refresh: config.scrapeDefaults.refresh,
				respectRobots: params.respectRobots,
			},
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
	const resultWithMetadata: VerticalResultWithMetadata = prerenderedPage
		? {
				...result,
				browserFallback: {
					used: true,
					backend: params.browserBackend ?? "cloak",
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
}

async function maybePrerenderVerticalPage(
	url: string,
	params: Params,
	scrapeDeps: ScrapePipelineDeps | undefined,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
): Promise<VerticalExtractorPage | undefined> {
	if (params.mode !== "browser") return;
	await emitProgress(onUpdate, {
		state: "loading",
		url,
		message: "rendering page for vertical fallback",
	});
	const result = await scrapeUrl(
		url,
		{
			mode: "browser",
			format: "html",
			browserBackend: params.browserBackend,
			sessionId: params.sessionId,
			saveSession: params.saveSession,
			clearSession: params.clearSession,
			respectRobots: params.respectRobots,
		},
		scrapeDeps,
		signal,
	);
	if (result.error) return;
	return {
		requestedUrl: url,
		finalUrl: result.finalUrl ?? result.url ?? url,
		status: result.status ?? 200,
		contentType: result.contentType,
		text: result.data.html ?? result.data.text ?? result.summary ?? "",
		html: result.data.html,
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
		return `\u2514\u2500 \u2715 ${name} failed \u00B7 ${result.error.code}`;
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
		return `\u2514\u2500 \u2715 ${name} failed \u00B7 ${result.error.code}`;
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

	// Views (youtube)
	if (typeof d.views === "number" && d.views > 0) {
		parts.push(`${(d.views / 1000000).toFixed(d.views >= 100000000 ? 0 : 1)}M views`);
	} else if (typeof d.views === "string" && d.views) {
		parts.push(`${d.views} views`);
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
