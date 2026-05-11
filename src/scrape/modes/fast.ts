/** @file Scrape modes fast module. */
import type { FetchUrlResult, HttpClient } from "../../http/client.ts";
import { createHttpClient } from "../../http/client.ts";
import {
	binaryAttachmentInfo,
	parseJsonText,
	type RoutedContentKind,
	routeContentType,
} from "../../parse/content/route.ts";
import { parseMarkdown, parseMdx, parseRst } from "../../parse/markup/doc.ts";
import { parseDocstrings } from "../../parse/markup/docstrings.ts";
import { extractFastPage } from "../../parse/page/fast.ts";
import {
	docstringsToText,
	markupDocumentToMarkdown,
	markupDocumentToText,
} from "../../serialize/structured-doc.ts";
import { normalizeWhitespace } from "../../serialize/text.ts";
import type { CommonScrapeOptions, OutputFormat, ScrapeMode } from "../../types.ts";
import { pdfResult } from "../pdf-route.ts";
import type { ScrapePipelineDeps, ScrapeResult } from "../pipeline.ts";
import { renderFormat } from "../render.ts";
import { analyzeFastResult, combineRecoveredText } from "../signals.ts";
import { fetchOptions, resultBase } from "./mode-helpers.ts";

export async function httpScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	return await responseScrape(
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
	return await (deps.httpClient ?? createHttpClient()).fetchUrl(
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
		return await pdfResult(
			base,
			response.body ?? new Uint8Array(),
			response.file,
			format,
			mode,
			signal,
		);
	if (!route.shouldParseHtml)
		return passthroughResult(base, route.kind, response.text ?? "", format, mode);
	return htmlResult(base, response.text ?? "", response.finalUrl, mode, options);
}

function passthroughResult(
	base: ScrapeResult,
	route: RoutedContentKind,
	text: string,
	format: OutputFormat,
	mode: ScrapeMode,
): ScrapeResult {
	const parsed = parsePassthroughContent(route, text, base.finalUrl ?? base.url);
	const normalized = normalizeWhitespace(parsed.text);
	const json = route === "json" ? safeParseJson(text) : parsed.json;
	const rendered = renderFormat(format, {
		text: normalized,
		markdown: parsed.markdown,
		html: text,
		json,
	});
	return {
		...base,
		data: { route, extractionPath: [mode], ...rendered, json },
	};
}

function parsePassthroughContent(
	route: RoutedContentKind,
	text: string,
	file?: string,
): { text: string; markdown?: string; json?: unknown } {
	if (route === "markdown") {
		const document = parseMarkdown(text, file);
		return {
			text: markupDocumentToText(document),
			markdown: markupDocumentToMarkdown(document),
			json: document,
		};
	}
	if (route === "mdx") {
		const document = parseMdx(text, file);
		return {
			text: markupDocumentToText(document),
			markdown: markupDocumentToMarkdown(document),
			json: document,
		};
	}
	if (route === "rst") {
		const document = parseRst(text, file);
		return {
			text: markupDocumentToText(document),
			markdown: markupDocumentToMarkdown(document),
			json: document,
		};
	}
	if (route === "source") {
		const document = parseDocstrings(text, file);
		return {
			text: docstringsToText(document),
			markdown: docstringsToText(document),
			json: document,
		};
	}
	return { text: normalizeWhitespace(text) };
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
		/* ignore */
	}
}
