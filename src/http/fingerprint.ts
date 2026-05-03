import type { StructuredError } from "../types.js";
import type { FetchUrlOptions, FetchUrlResult, HttpClientOptions } from "./client.js";
import { HttpClient } from "./client.js";

export interface FingerprintProfile {
  browserProfile?: string;
  osProfile?: string;
  proxy?: string;
}

export interface FingerprintFetchOptions extends FetchUrlOptions, FingerprintProfile {}

export interface FingerprintFetchAdapter {
  fetch(url: string | URL, options?: FingerprintFetchOptions, signal?: AbortSignal): Promise<FetchUrlResult>;
}

const pool = new Map<string, FingerprintFetchAdapter>();

export class UnsupportedFingerprintOptionError extends Error {
  readonly structured: StructuredError;

  constructor(option: string) {
    super(`Fingerprint fallback does not support ${option} yet`);
    this.name = "UnsupportedFingerprintOptionError";
    this.structured = {
      code: "UNSUPPORTED_FINGERPRINT_OPTION",
      phase: "fingerprint",
      message: this.message,
      retryable: false,
    };
  }
}

/**
 * Current baseline boundary for fingerprinted static fetching.
 *
 * Browser and OS profile fields are honored only as pool keys today. Proxy is
 * rejected explicitly until a real proxy-capable fingerprint backend exists.
 * The fallback adapter does not yet emulate a full browser TLS/HTTP
 * fingerprint. It intentionally reuses the safe Undici HTTP path with
 * browser-like request headers so callers can wire `mode: "fingerprint"`
 * without pulling in Playwright or overpromising anti-bot behavior. A future
 * optional backend can replace `StaticFingerprintAdapter` behind this boundary.
 */
export function getFingerprintFetchAdapter(
  profile: FingerprintProfile = {},
  clientOptions: HttpClientOptions = {},
): FingerprintFetchAdapter {
  assertSupportedFingerprintOptions(profile);
  const key = JSON.stringify({
    browserProfile: profile.browserProfile ?? "default",
    osProfile: profile.osProfile ?? "default",
  });
  const existing = pool.get(key);
  if (existing) {
    return existing;
  }

  const adapter = new StaticFingerprintAdapter(clientOptions);
  pool.set(key, adapter);
  return adapter;
}

function assertSupportedFingerprintOptions(profile: FingerprintProfile): void {
  if (profile.proxy) {
    throw new UnsupportedFingerprintOptionError("proxy");
  }
}

class StaticFingerprintAdapter implements FingerprintFetchAdapter {
  private readonly client: HttpClient;

  constructor(clientOptions: HttpClientOptions) {
    this.client = new HttpClient(clientOptions);
  }

  async fetch(url: string | URL, options: FingerprintFetchOptions = {}, signal?: AbortSignal): Promise<FetchUrlResult> {
    assertSupportedFingerprintOptions(options);
    return this.client.fetchUrl(url, {
      ...options,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "upgrade-insecure-requests": "1",
        ...options.headers,
      },
    }, signal);
  }
}
