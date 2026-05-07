import type { FetchUrlResult, HttpClient } from "../../http/client.js";
import { createHttpClient } from "../../http/client.js";
import { extractFastPage } from "../../parse/fast.js";
import {
	binaryAttachmentInfo,
	parseJsonText,
	type RoutedContentKind,
	routeContentType,
} from "../../parse/passthrough.js";
import { normalizeWhitespace } from "../../serialize/text.js";
import type {
	CommonScrapeOptions,
	OutputFormat,
	ScrapeMode,
} from "../../types.js";
import { pdfResult } from "../pdf-route.js";
import type { ScrapePipelineDeps, ScrapeResult } from "../pipeline.js";
import { renderFormat } from "../render.js";
import { analyzeFastResult, combineRecoveredText } from "../signals.js";
import { fetchOptions, resultBase } from "./shared.js";

export async function httpScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	return responseScrape(
		await httpFetch(input, options, deps, signal),
		"fast",
		format,
		options,
		signal,
	);
}

async function httpFetch(
	input: string | URL,
	options: CommonScrapeOptions,
	deps: { httpClient?: Pick<HttpClient, "fetchUrl"> },
	signal?: AbortSignal,
): Promise<FetchUrlResult> {
	return (deps.httpClient ?? createHttpClient()).fetchUrl(
		input,
		fetchOptions(options),
		signal,
	);
}

export async function responseScrape(
	response: FetchUrlResult,
	mode: ScrapeMode,
	format: OutputFormat,
	options: CommonScrapeOptions,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	const route = routeContentType(response.contentType, response.finalUrl);
	const base = resultBase(
		response.url,
		response.finalUrl,
		response.status,
		mode,
		format,
		response.contentType,
		response.downloadedBytes,
		response.cache,
	);
	if (route.kind === "binary")
		return {
			...base,
			data: {
				route: "binary",
				extractionPath: [mode],
				file: response.file && binaryAttachmentInfo(response.file),
			},
		};
	if (route.kind === "pdf")
		return pdfResult(
			base,
			response.body ?? new Uint8Array(),
			response.file,
			format,
			mode,
			signal,
		);
	if (!route.shouldParseHtml)
		return passthroughResult(
			base,
			route.kind,
			response.text ?? "",
			format,
			mode,
		);
	return htmlResult(
		base,
		response.text ?? "",
		response.finalUrl,
		mode,
		options,
	);
}

function passthroughResult(
	base: ScrapeResult,
	route: RoutedContentKind,
	text: string,
	format: OutputFormat,
	mode: ScrapeMode,
): ScrapeResult {
	const normalized = normalizeWhitespace(text);
	const json = route === "json" ? safeParseJson(text) : undefined;
	const rendered = renderFormat(format, {
		text: normalized,
		markdown: route === "markdown" ? normalized : undefined,
		html: text,
		json,
	});
	return {
		...base,
		data: { route, extractionPath: [mode], ...rendered, json },
	};
}

function htmlResult(
	base: ScrapeResult,
	html: string,
	finalUrl: string,
	mode: ScrapeMode,
	options: CommonScrapeOptions,
): ScrapeResult {
	const extraction = extractFastPage(html, finalUrl, options);
	const text = combineRecoveredText(extraction);
	const signals = analyzeFastResult(
		{
			...base,
			text: html,
			contentType: base.contentType,
			downloadedBytes: base.downloadedBytes ?? 0,
			headers: {},
		} as FetchUrlResult,
		extraction,
	);
	const metadata = extraction.metadata as unknown as Record<string, unknown>;
	return {
		...base,
		data: {
			route: "html",
			extractionPath: [mode],
			title: extraction.title,
			description: extraction.description,
			text,
			html: extraction.html,
			metadata,
			links: extraction.links,
			signals,
			blocked: signals.blockedLikely,
		},
	};
}

function safeParseJson(text: string): unknown {
	try {
		return parseJsonText(text);
	} catch {
		return undefined;
	}
}
