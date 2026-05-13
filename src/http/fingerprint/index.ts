/** @file Http fingerprint module. */
import type { HttpClientOptions } from "../client.ts";
import { SafeFingerprintAdapter } from "./adapter.ts";
import { impitBackendFactory } from "./impit-backend.ts";
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

export function registerFingerprintBackendFactory(factory: FingerprintBackendFactory): () => void {
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
 *   Pi-scraper bundles `impit` (Apache-2.0, Apify-maintained) as the default TLS/HTTP
 *   fingerprinting backend. The contract requires no-follow-redirect semantics so pi-scraper owns
 *   the redirect chain; `impit` is configured per-hop in `impit-backend.ts`. Tests and power users
 *   can swap backends via `registerFingerprintBackendFactory()` — the return value is an unregister
 *   handle. Absence of any backend is reported as a structured unsupported result.
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

	const adapter = createFingerprintFetchAdapter(factory, profile, clientOptions);
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

// Auto-register the bundled impit backend. Pi-scraper users get
// mode: "fingerprint" out of the box. Tests can swap via
// registerFingerprintBackendFactory() — the unregister return value works.
registerFingerprintBackendFactory(impitBackendFactory);

function adapterPoolKey(profile: FingerprintProfile, options: HttpClientOptions): string {
	return JSON.stringify({
		browserProfile: profile.browserProfile ?? "chrome",
		osProfile: profile.osProfile ?? "default",
		proxy: profile.proxy,
		allowPrivateNetwork: options.allowPrivateNetwork === true,
		resolveDns: options.resolveDns !== false,
		maxRedirects: options.maxRedirects ?? 5,
	});
}
