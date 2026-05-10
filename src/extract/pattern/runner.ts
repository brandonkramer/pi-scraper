/**
 * @fileoverview Pattern source preparation — scrape or use provided content.
 */
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import { type ScrapePipelineDeps, scrapeUrl } from "../../scrape/pipeline.ts";
import {
	evaluateJsonPaths,
	flattenJsonValues,
	isSupportedJsonPath,
	parseJsonSafe,
} from "../selector/json-path.ts";
import { PatternInspectError } from "./errors.ts";
import type { PatternInspectOptions, PatternInspectResult, PatternSourceFormat } from "./index.ts";
import type { OutputFormat } from "../../types.ts";

const SOURCE_FORMATS = ["text", "markdown", "html", "json"] as const;

export async function preparePatternSource(
	options: PatternInspectOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<{
	content: string;
	source: Omit<
		PatternInspectResult["source"],
		"length" | "inspectedLength" | "truncated"
	>;
}> {
	const sourceFormat = options.sourceFormat ?? "text";
	if (!SOURCE_FORMATS.includes(sourceFormat)) {
		throw new PatternInspectError(
			`Unsupported sourceFormat: ${sourceFormat}`,
			"PATTERN_INPUT_INVALID",
			options.url,
		);
	}
	if (sourceFormat === "json" && options.jsonPaths?.length) {
		const invalidPath = options.jsonPaths.find((p) => !isSupportedJsonPath(p));
		if (invalidPath) {
			throw new PatternInspectError(
				`Unsupported JSONPath syntax: ${invalidPath}`,
				"JSON_PATH_UNSUPPORTED",
				options.url,
			);
		}
	}
	if (options.content !== undefined) {
		if (sourceFormat === "json") {
			return prepareJsonSource(options.content, {
				url: options.url,
				jsonPaths: options.jsonPaths,
				source: "provided",
			});
		}
		return {
			content: options.content,
			source: { url: options.url, source: "provided", sourceFormat },
		};
	}
	if (!options.url) {
		throw new PatternInspectError(
			"web_extract action=pattern requires url or content.",
			"MISSING_INPUT",
		);
	}
	const { content, include, extractSchema, jsonPaths, ...scrapeOptions } =
		options;
	void content;
	void include;
	void extractSchema;
	void jsonPaths;
	const scrape = await scrapeUrl(
		options.url,
		{ ...scrapeOptions, format: sourceFormat as OutputFormat },
		deps,
		signal,
	);
	if (sourceFormat === "json") {
		const jsonText =
			scrape.data.json !== undefined
				? JSON.stringify(scrape.data.json)
				: (scrape.data.text ?? "");
		return prepareJsonSource(jsonText, {
			url: options.url,
			finalUrl: scrape.finalUrl,
			jsonPaths: options.jsonPaths,
			source: "scrape",
			mode: scrape.mode,
			status: scrape.status,
			contentType: scrape.contentType,
			cache: scrape.cache,
		});
	}
	return {
		content: contentForFormat(scrape, sourceFormat),
		source: {
			url: options.url,
			finalUrl: scrape.finalUrl,
			source: "scrape",
			sourceFormat,
			mode: scrape.mode,
			status: scrape.status,
			contentType: scrape.contentType,
			cache: scrape.cache,
		},
	};
}

function prepareJsonSource(
	content: string,
	meta: {
		url?: string;
		finalUrl?: string;
		jsonPaths?: string[];
		source: "provided" | "scrape";
		mode?: string;
		status?: number;
		contentType?: string;
		cache?: ScrapeResult["cache"];
	},
): {
	content: string;
	source: Omit<
		PatternInspectResult["source"],
		"length" | "inspectedLength" | "truncated"
	>;
} {
	const parsed = parseJsonSafe(content);
	if (parsed.error) {
		throw new PatternInspectError(
			parsed.error.message,
			parsed.error.code,
			meta.url,
		);
	}
	const paths = meta.jsonPaths?.length ? meta.jsonPaths : ["$"];
	const { values, infos, errors } = evaluateJsonPaths(parsed.data, paths);
	if (errors.length) {
		throw new PatternInspectError(
			errors.map((e) => `${e.path}: ${e.message}`).join("; "),
			errors[0]!.code,
			meta.url,
		);
	}
	const allMissing = infos.every((info) => info.missing);
	if (allMissing && infos.length > 0) {
		throw new PatternInspectError(
			`No values matched JSONPath expressions.`,
			"JSON_PATH_NO_MATCH",
			meta.url,
		);
	}
	const selectedText = flattenJsonValues(values);
	return {
		content: selectedText,
		source: {
			url: meta.url,
			finalUrl: meta.finalUrl,
			source: meta.source,
			sourceFormat: "json",
			mode: meta.mode,
			status: meta.status,
			contentType: meta.contentType,
			cache: meta.cache,
			json: {
				paths: infos,
				selectedLength: selectedText.length,
			},
		},
	};
}

function contentForFormat(
	scrape: ScrapeResult,
	format: PatternSourceFormat,
): string {
	if (format === "html") return scrape.data.html ?? scrape.data.text ?? "";
	if (format === "markdown")
		return scrape.data.markdown ?? scrape.data.text ?? "";
	if (format === "json") {
		if (scrape.data.json !== undefined) {
			try {
				return JSON.stringify(scrape.data.json);
			} catch {
				return String(scrape.data.json);
			}
		}
		return scrape.data.text ?? "";
	}
	return scrape.data.text ?? scrape.data.markdown ?? scrape.data.html ?? "";
}
