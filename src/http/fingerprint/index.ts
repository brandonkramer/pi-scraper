/**
 * @fileoverview http fingerprint module.
 */
import type { HttpClientOptions } from "../client.ts";
import { SafeFingerprintAdapter } from "./adapter.ts";
import {
	assertSupportedFingerprintOptions,
	MissingFingerprintBackendError,
	UnsupportedFingerprintOptionError,
	isFingerprintFetchError,
	type FingerprintBackendFactory,
	type FingerprintBackendKey,
	type FingerprintBackendRequestOptions,
	type FingerprintBackendResponse,
	type FingerprintFetchAdapter,
	type FingerprintFetchOptions,
	type FingerprintProfile,
	type FingerprintRequestBackend,
} from "./types.ts";

export {
	MissingFingerprintBackendError,
	UnsupportedFingerprintOptionError,
	isFingerprintFetchError,
	type FingerprintBackendFactory,
	type FingerprintBackendKey,
	type FingerprintBackendRequestOptions,
	type FingerprintBackendResponse,
	type FingerprintFetchAdapter,
	type FingerprintFetchOptions,
	type FingerprintProfile,
	type FingerprintRequestBackend,
};

const adapterPool = new Map<string, FingerprintFetchAdapter>();
let registeredBackendFactory: FingerprintBackendFactory | undefined;

export function registerFingerprintBackendFactory(
	factory: FingerprintBackendFactory,
): () => void {
	registeredBackendFactory = factory;
	adapterPool.clear();
	return () => {
		if (registeredBackendFactory === factory) {
			registeredBackendFactory = undefined;
			adapterPool.clear();
		}
	};
}

/**
 * Resolves the optional fingerprint fetch adapter.
 *
 * @remarks
 * pi-scraper does not bundle a TLS/HTTP impersonation backend because candidate
 * packages must expose no-follow-redirect semantics and must not hide DNS or
 * proxy behavior from the shared SSRF policy. Installers may register a backend
 * factory explicitly; absence is reported as a structured unsupported result.
 */
export function getFingerprintFetchAdapter(
	profile: FingerprintProfile = {},
	clientOptions: HttpClientOptions = {},
): FingerprintFetchAdapter {
	assertSupportedFingerprintOptions(profile);
	const factory = registeredBackendFactory;
	if (!factory) {
		throw new MissingFingerprintBackendError();
	}

	const key = adapterPoolKey(profile, clientOptions);
	const existing = adapterPool.get(key);
	if (existing) return existing;

	const adapter = createFingerprintFetchAdapter(
		factory,
		profile,
		clientOptions,
	);
	adapterPool.set(key, adapter);
	return adapter;
}

export function createFingerprintFetchAdapter(
	factory: FingerprintBackendFactory,
	profile: FingerprintProfile = {},
	clientOptions: HttpClientOptions = {},
): FingerprintFetchAdapter {
	assertSupportedFingerprintOptions(profile);
	return new SafeFingerprintAdapter(factory, profile, clientOptions);
}

function adapterPoolKey(
	profile: FingerprintProfile,
	options: HttpClientOptions,
): string {
	return JSON.stringify({
		browserProfile: profile.browserProfile ?? "chrome",
		osProfile: profile.osProfile ?? "default",
		proxy: profile.proxy,
		allowPrivateNetwork: options.allowPrivateNetwork === true,
		resolveDns: options.resolveDns !== false,
		maxRedirects: options.maxRedirects ?? 5,
	});
}
