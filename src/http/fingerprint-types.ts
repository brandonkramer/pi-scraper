/**
 * @fileoverview http fingerprint-types module.
 */
import type { StructuredError } from "../types.ts";
import type { FetchUrlOptions, FetchUrlResult } from "./client.ts";
import { HttpClientError } from "./errors.ts";

export interface FingerprintProfile {
	browserProfile?: string;
	osProfile?: string;
	proxy?: string;
}

export interface FingerprintFetchOptions
	extends FetchUrlOptions,
		FingerprintProfile {}

export interface FingerprintFetchAdapter {
	fetch(
		url: string | URL,
		options?: FingerprintFetchOptions,
		signal?: AbortSignal,
	): Promise<FetchUrlResult>;
}

export interface FingerprintBackendKey
	extends Required<Omit<FingerprintProfile, "proxy">> {
	host: string;
	proxy?: string;
}

export interface FingerprintBackendRequestOptions {
	method: "GET" | "HEAD";
	headers: Record<string, string>;
	timeoutMs: number;
	maxBytes: number;
	browserProfile: string;
	osProfile: string;
}

export interface FingerprintBackendResponse {
	status: number;
	statusText?: string;
	headers?: Record<string, string | string[] | undefined>;
	body?: Buffer | Uint8Array | string;
}

export interface FingerprintRequestBackend {
	/**
	 * Fetch exactly one already-normalized HTTP(S) URL without following redirects.
	 *
	 * @remarks
	 * This invariant lets pi-scraper revalidate every redirect hop with its shared
	 * URL safety policy before any next-hop request. Backends that cannot disable
	 * internal redirect following are not safe to register here.
	 */
	fetchOnce(
		url: string,
		options: FingerprintBackendRequestOptions,
		signal?: AbortSignal,
	): Promise<FingerprintBackendResponse>;
}

export type FingerprintBackendFactory = (
	key: FingerprintBackendKey,
) => FingerprintRequestBackend | Promise<FingerprintRequestBackend>;

export class MissingFingerprintBackendError extends Error {
	readonly structured: StructuredError;

	constructor() {
		super(
			"mode: fingerprint requires a configured fingerprint backend; no safe built-in backend is bundled.",
		);
		this.name = "MissingFingerprintBackendError";
		this.structured = {
			code: "FINGERPRINT_BACKEND_MISSING",
			phase: "fingerprint",
			message: this.message,
			retryable: false,
		};
	}
}

export class UnsupportedFingerprintOptionError extends Error {
	readonly structured: StructuredError;

	constructor(option: string) {
		super(`Fingerprint backend does not support ${option} safely yet`);
		this.name = "UnsupportedFingerprintOptionError";
		this.structured = {
			code: "UNSUPPORTED_FINGERPRINT_OPTION",
			phase: "fingerprint",
			message: this.message,
			retryable: false,
		};
	}
}

export function assertSupportedFingerprintOptions(
	profile: FingerprintProfile,
): void {
	if (profile.proxy) {
		throw new UnsupportedFingerprintOptionError("proxy");
	}
}

export function isFingerprintFetchError(
	error: unknown,
): error is { structured: StructuredError } {
	return (
		error instanceof MissingFingerprintBackendError ||
		error instanceof UnsupportedFingerprintOptionError ||
		error instanceof HttpClientError
	);
}
