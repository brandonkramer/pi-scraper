/** @file Shared HTTP response materialization helpers. */
import { Readable } from "node:stream";

import type { CacheMetadata } from "../types.ts";
import {
	BodySizeLimitError,
	collectBody,
	enforceContentLength,
	isPdfContentType,
	isTextLikeContentType,
	streamToTempFile,
	type BinaryDownloadMetadata,
} from "./download.ts";
import { decodeText } from "./text-decode.ts";

export interface FetchUrlResult {
	/**
	 * Normalized original request URL after URL policy canonicalization, not the verbatim input
	 * string.
	 */
	url: string;
	/** Normalized URL of the response actually fetched after HTTP redirects. */
	finalUrl: string;
	status: number;
	statusText?: string;
	headers: Record<string, string>;
	contentType?: string;
	body?: Buffer;
	text?: string;
	file?: BinaryDownloadMetadata;
	downloadedBytes: number;
	cache?: CacheMetadata;
	diagnostics?: Record<string, unknown>;
}

export interface FetchResponseMaterializeOptions {
	method?: string;
	downloadBinary?: boolean;
	forceText?: boolean;
}

export function createFetchUrlResult(input: {
	url: string;
	status: number;
	statusText?: string;
	headers: Record<string, string>;
	contentType?: string;
	downloadedBytes: number;
}): FetchUrlResult {
	return {
		url: input.url,
		finalUrl: input.url,
		status: input.status,
		statusText: input.statusText,
		headers: input.headers,
		contentType: input.contentType,
		downloadedBytes: input.downloadedBytes,
	};
}

export async function materializeFetchStreamResponse(input: {
	url: string;
	status: number;
	statusText?: string;
	headers: Record<string, string>;
	body: AsyncIterable<Uint8Array>;
	maxBytes: number;
	options: FetchResponseMaterializeOptions;
	discardBody?: () => Promise<void>;
}): Promise<FetchUrlResult> {
	const contentType = input.headers["content-type"];
	enforceContentLength(input.headers["content-length"], input.maxBytes);
	if (input.options.method === "HEAD") {
		await input.discardBody?.();
		return createFetchUrlResult({
			url: input.url,
			status: input.status,
			statusText: input.statusText,
			headers: input.headers,
			contentType,
			downloadedBytes: 0,
		});
	}

	const parseablePdf = isPdfResponse(contentType, input.url);
	if (shouldDownloadBinary(input.options, contentType, parseablePdf)) {
		const file = await streamToTempFile(input.body, {
			maxBytes: input.maxBytes,
			contentType,
		});
		return {
			...createFetchUrlResult({
				url: input.url,
				status: input.status,
				statusText: input.statusText,
				headers: input.headers,
				contentType,
				downloadedBytes: file.downloadedBytes,
			}),
			file,
		};
	}

	const collected = await collectBody(input.body, input.maxBytes);
	return await materializeFetchBufferResponse({
		url: input.url,
		status: input.status,
		statusText: input.statusText,
		headers: input.headers,
		body: collected.buffer,
		maxBytes: input.maxBytes,
		options: input.options,
		downloadedBytes: collected.downloadedBytes,
	});
}

export async function materializeFetchBufferResponse(input: {
	url: string;
	status: number;
	statusText?: string;
	headers: Record<string, string>;
	body: Buffer;
	maxBytes: number;
	options: FetchResponseMaterializeOptions;
	downloadedBytes?: number;
}): Promise<FetchUrlResult> {
	const contentType = input.headers["content-type"];
	enforceContentLength(input.headers["content-length"], input.maxBytes);
	if (input.body.byteLength > input.maxBytes) {
		throw new BodySizeLimitError(input.maxBytes, input.body.byteLength);
	}
	if (input.options.method === "HEAD") {
		return createFetchUrlResult({
			url: input.url,
			status: input.status,
			statusText: input.statusText,
			headers: input.headers,
			contentType,
			downloadedBytes: 0,
		});
	}

	const parseablePdf = isPdfResponse(contentType, input.url);
	if (shouldDownloadBinary(input.options, contentType, parseablePdf)) {
		const file = await streamToTempFile(Readable.from([input.body]), {
			maxBytes: input.maxBytes,
			contentType,
		});
		return {
			...createFetchUrlResult({
				url: input.url,
				status: input.status,
				statusText: input.statusText,
				headers: input.headers,
				contentType,
				downloadedBytes: file.downloadedBytes,
			}),
			file,
		};
	}

	return {
		...createFetchUrlResult({
			url: input.url,
			status: input.status,
			statusText: input.statusText,
			headers: input.headers,
			contentType,
			downloadedBytes: input.downloadedBytes ?? input.body.byteLength,
		}),
		body: input.body,
		text: parseablePdf ? undefined : decodeText(input.body, contentType),
	};
}

function shouldDownloadBinary(
	options: FetchResponseMaterializeOptions,
	contentType: string | undefined,
	parseablePdf: boolean,
): boolean {
	return (
		options.downloadBinary === true ||
		(options.forceText !== true && !isTextLikeContentType(contentType) && !parseablePdf)
	);
}

function isPdfResponse(contentType: string | undefined, url: string): boolean {
	return isPdfContentType(contentType) || new URL(url).pathname.toLowerCase().endsWith(".pdf");
}
