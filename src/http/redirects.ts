/**
 * @fileoverview http redirects module.
 */
import { HttpClientError } from "./errors.js";

export function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

export function resolveRedirectUrl(location: string, baseUrl: string): string {
  return new URL(location, baseUrl).toString();
}

export function redirectError(code: string, message: string, url: string, finalUrl: string): HttpClientError {
  return new HttpClientError({ code, phase: "redirect", message, retryable: false, url, finalUrl });
}

export function redirectLimitError(url: string, finalUrl: string): HttpClientError {
  return redirectError("REDIRECT_LIMIT", `Redirect limit exceeded at ${finalUrl}`, url, finalUrl);
}

export function redirectLoopError(url: string, finalUrl: string, nextUrl: string): HttpClientError {
  return redirectError("REDIRECT_LOOP", `Redirect loop detected at ${nextUrl}`, url, finalUrl);
}
