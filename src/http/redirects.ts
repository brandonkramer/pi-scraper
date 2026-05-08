/**
 * @fileoverview http redirects module.
 */
import { HttpClientError } from "./errors.js";
import type { SafeUrlResult } from "./url-safety.js";

export interface RedirectableResponse {
	status: number;
	headers: { location?: string };
	url?: string;
	finalUrl?: string;
}

export interface RedirectFlowOptions<T extends RedirectableResponse> {
	initialSafe: SafeUrlResult;
	maxRedirects: number;
	fetchRequest: (safe: SafeUrlResult) => Promise<T>;
	resolveSafeUrl: (url: string) => Promise<SafeUrlResult>;
}

export function isRedirectStatus(status: number): boolean {
	return [301, 302, 303, 307, 308].includes(status);
}

export async function followRedirects<T extends RedirectableResponse>({
	initialSafe,
	maxRedirects,
	fetchRequest,
	resolveSafeUrl,
}: RedirectFlowOptions<T>): Promise<T & { url: string; finalUrl: string }> {
	const initialUrl = initialSafe.normalizedUrl;
	const visited = new Set<string>([initialUrl]);
	let currentSafe = initialSafe;

	for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
		const result = await fetchRequest(currentSafe);
		if (!isRedirectStatus(result.status) || !result.headers.location) {
			return {
				...result,
				url: initialUrl,
				finalUrl: currentSafe.normalizedUrl,
			};
		}

		if (redirects >= maxRedirects) {
			throw redirectLimitError(initialUrl, currentSafe.normalizedUrl);
		}

		const next = await resolveSafeUrl(
			resolveRedirectUrl(result.headers.location, currentSafe.normalizedUrl),
		);
		if (visited.has(next.normalizedUrl)) {
			throw redirectLoopError(
				initialUrl,
				currentSafe.normalizedUrl,
				next.normalizedUrl,
			);
		}
		visited.add(next.normalizedUrl);
		currentSafe = next;
	}

	throw redirectLimitError(initialUrl, currentSafe.normalizedUrl);
}

export function resolveRedirectUrl(location: string, baseUrl: string): string {
	return new URL(location, baseUrl).toString();
}

export function redirectError(
	code: string,
	message: string,
	url: string,
	finalUrl: string,
): HttpClientError {
	return new HttpClientError({
		code,
		phase: "redirect",
		message,
		retryable: false,
		url,
		finalUrl,
	});
}

export function redirectLimitError(
	url: string,
	finalUrl: string,
): HttpClientError {
	return redirectError(
		"REDIRECT_LIMIT",
		`Redirect limit exceeded at ${finalUrl}`,
		url,
		finalUrl,
	);
}

export function redirectLoopError(
	url: string,
	finalUrl: string,
	nextUrl: string,
): HttpClientError {
	return redirectError(
		"REDIRECT_LOOP",
		`Redirect loop detected at ${nextUrl}`,
		url,
		finalUrl,
	);
}
