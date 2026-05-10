/**
 * @fileoverview url normalize module.
 */
import { COMMON_TRACKING_QUERY_PARAMS } from "../defaults.ts";

export interface NormalizeUrlOptions {
  stripTrackingParams?: boolean;
  stripFragment?: boolean;
  trimTrailingSlash?: boolean;
}

const TRACKING_PARAMS = new Set(
  COMMON_TRACKING_QUERY_PARAMS.map((param) => param.toLowerCase()),
);

export function normalizeUrl(
  input: string | URL,
  options: NormalizeUrlOptions = {},
): string {
  const {
    stripTrackingParams = true,
    stripFragment = true,
    trimTrailingSlash = true,
  } = options;
  const url = new URL(input.toString());

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (isDefaultPort(url.protocol, url.port)) {
    url.port = "";
  }

  if (stripFragment) {
    url.hash = "";
  }

  const sortedParams = [...url.searchParams.entries()]
    .filter(([key]) => !stripTrackingParams || !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = leftKey.localeCompare(rightKey);
      return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
    });
  url.search = "";
  for (const [key, value] of sortedParams) {
    url.searchParams.append(key, value);
  }

  if (trimTrailingSlash && url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  }

  return url.toString();
}

function isDefaultPort(protocol: string, port: string): boolean {
  return (protocol === "http:" && port === "80") ||
    (protocol === "https:" && port === "443");
}
