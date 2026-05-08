/**
 * @fileoverview http url-safety module.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { StructuredError } from "../types.js";
import { normalizeUrl, type NormalizeUrlOptions } from "../url/normalize.js";

export interface UrlSafetyOptions extends NormalizeUrlOptions {
  allowPrivateNetwork?: boolean;
  resolveDns?: boolean;
}

export interface SafeUrlResult {
  url: URL;
  normalizedUrl: string;
  checkedAddresses: string[];
}

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal"] as const;

export class UrlSafetyError extends Error {
  readonly structured: StructuredError;

  constructor(code: string, message: string, url?: string) {
    super(message);
    this.name = "UrlSafetyError";
    this.structured = {
      code,
      phase: "url_safety",
      message,
      retryable: false,
      url,
    };
  }
}

export function assertSafeUrl(
  input: string | URL,
  options: UrlSafetyOptions = {},
): SafeUrlResult {
  const normalizedUrl = normalizeUrl(input, options);
  const url = new URL(normalizedUrl);
  validateProtocol(url);
  validateHostname(url, options);
  return { url, normalizedUrl, checkedAddresses: [] };
}

export async function assertSafeFetchUrl(
  input: string | URL,
  options: UrlSafetyOptions = {},
): Promise<SafeUrlResult> {
  const result = assertSafeUrl(input, options);
  if (options.resolveDns === false || options.allowPrivateNetwork === true) {
    return result;
  }

  const family = isIP(result.url.hostname);
  if (family !== 0) {
    return result;
  }

  const records = await lookup(result.url.hostname, { all: true, verbatim: true });
  const checkedAddresses = records.map((record) => record.address);
  assertPublicAddresses(checkedAddresses, result.normalizedUrl);
  return { ...result, checkedAddresses };
}

export function assertPublicAddresses(addresses: readonly string[], url?: string): void {
  for (const address of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new UrlSafetyError(
        "PRIVATE_NETWORK_ADDRESS",
        `Hostname resolves to blocked private address: ${address}`,
        url,
      );
    }
  }
}

function validateProtocol(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlSafetyError(
      "UNSUPPORTED_URL_SCHEME",
      `Only http: and https: URLs are supported, received ${url.protocol}`,
      url.toString(),
    );
  }
}

function validateHostname(url: URL, options: UrlSafetyOptions): void {
  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
  if (!hostname) {
    throw new UrlSafetyError("MISSING_HOSTNAME", "URL must include a hostname", url.toString());
  }

  if (hostname === "localhost" || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new UrlSafetyError("PRIVATE_HOSTNAME", `Blocked private hostname: ${hostname}`, url.toString());
  }

  if (options.allowPrivateNetwork === true) {
    return;
  }

  if (isPrivateOrReservedIp(hostname)) {
    throw new UrlSafetyError("PRIVATE_NETWORK_ADDRESS", `Blocked private address: ${hostname}`, url.toString());
  }
}

export function isPrivateOrReservedIp(address: string): boolean {
  const hostname = stripIpv6Brackets(address).toLowerCase();
  const family = isIP(hostname);
  if (family === 4) {
    return isPrivateOrReservedIpv4(hostname);
  }
  if (family === 6) {
    return isPrivateOrReservedIpv6(hostname);
  }
  return false;
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  const [a = 0, b = 0] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a === 100 && b >= 64 && b <= 127 ||
    a >= 224;
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const embeddedIpv4 = address.match(/(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  if (embeddedIpv4) {
    return isPrivateOrReservedIpv4(embeddedIpv4);
  }

  const first = firstHextet(address);
  const second = hextetAt(address, 1);
  const third = hextetAt(address, 2);
  const fourth = hextetAt(address, 3);
  return address === "::" ||
    address === "::1" ||
    (first & 0xff00) === 0x0000 || // ::/8 reserved/unspecified/IPv4-compatible space.
    first === 0x0100 && second === 0 && third === 0 && fourth === 0 || // 100::/64 discard-only prefix.
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local addresses.
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local addresses.
    (first & 0xff00) === 0xff00 || // ff00::/8 multicast addresses.
    first === 0x2002 || // 2002::/16 6to4, avoid bypass through embedded IPv4.
    (first === 0x2001 && second === 0x0db8); // 2001:db8::/32 documentation space.
}

function firstHextet(address: string): number {
  return parseHextet(address.split(":", 1)[0] ?? "0");
}

function hextetAt(address: string, index: number): number {
  const parts = address.split(":");
  return parseHextet(parts[index] ?? "0");
}

function parseHextet(value: string): number {
  const parsed = Number.parseInt(value || "0", 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}
