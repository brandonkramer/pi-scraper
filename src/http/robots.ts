/**
 * @fileoverview http robots module.
 */
import { createRequire } from "node:module";
import { DEFAULT_USER_AGENT } from "../defaults.js";

interface RobotsTextFetchResult {
  status: number;
  text?: string;
  body?: Buffer;
}

export interface RobotsTextClient {
  fetchUrl(
    url: string,
    options: {
      respectRobots: false;
      timeoutSeconds: number;
      maxBytes: number;
      headers: Record<string, string>;
      forceText: true;
    },
    signal?: AbortSignal,
  ): Promise<RobotsTextFetchResult>;
}

interface RobotsParserResult {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
  getCrawlDelay(userAgent?: string): number | undefined;
  getSitemaps(): string[];
}

const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (url: string, body: string) => RobotsParserResult;

export interface RobotsRules {
  isAllowed(url: string, userAgent?: string): boolean;
  crawlDelay(userAgent?: string): number | undefined;
  sitemaps(): string[];
}

export interface RobotsCacheOptions {
  userAgent?: string;
  fetchText: (url: string, signal?: AbortSignal) => Promise<{ status: number; text: string }>;
}

export async function loadRobotsText(
  client: RobotsTextClient,
  url: string,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const result = await client.fetchUrl(
    url,
    {
      respectRobots: false,
      timeoutSeconds: 5,
      maxBytes: 256 * 1024,
      headers: { accept: "text/plain,*/*;q=0.1" },
      forceText: true,
    },
    signal,
  );
  return {
    status: result.status,
    text: result.text ?? result.body?.toString("utf8") ?? "",
  };
}

interface CacheEntry {
  rules: RobotsRules;
  fetchedAt: number;
  cacheable: boolean;
}

export class RobotsDeniedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows fetching ${url}`);
    this.name = "RobotsDeniedError";
  }
}

export class RobotsCache {
  private readonly cache = new Map<string, Promise<CacheEntry>>();
  private readonly userAgent: string;

  constructor(private readonly options: RobotsCacheOptions) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async rulesFor(url: string, signal?: AbortSignal): Promise<RobotsRules> {
    const robotsUrl = robotsUrlFor(url);
    let entry = this.cache.get(robotsUrl);
    if (!entry) {
      entry = this.cachedLoadRules(robotsUrl, signal);
      this.cache.set(robotsUrl, entry);
    }
    return (await entry).rules;
  }

  async assertAllowed(url: string, signal?: AbortSignal): Promise<RobotsRules> {
    const rules = await this.rulesFor(url, signal);
    if (!rules.isAllowed(url, this.userAgent)) {
      throw new RobotsDeniedError(url);
    }
    return rules;
  }

  private cachedLoadRules(robotsUrl: string, signal?: AbortSignal): Promise<CacheEntry> {
    const promise = this.loadRules(robotsUrl, signal).then(
      (entry) => {
        if (!entry.cacheable && this.cache.get(robotsUrl) === promise) {
          this.cache.delete(robotsUrl);
        }
        return entry;
      },
      (error: unknown) => {
        if (this.cache.get(robotsUrl) === promise) {
          this.cache.delete(robotsUrl);
        }
        throw error;
      },
    );
    return promise;
  }

  private async loadRules(robotsUrl: string, signal?: AbortSignal): Promise<CacheEntry> {
    try {
      const response = await this.options.fetchText(robotsUrl, signal);
      if (response.status >= 500) {
        // RFC-style fail-closed behavior for temporary server failures: do not
        // permanently cache allow-all rules when robots.txt is unavailable.
        return { rules: disallowAllRules(), fetchedAt: Date.now(), cacheable: false };
      }
      if (response.status >= 400) {
        return { rules: allowAllRules(), fetchedAt: Date.now(), cacheable: true };
      }
      return { rules: parseRobots(robotsUrl, response.text), fetchedAt: Date.now(), cacheable: true };
    } catch (error) {
      if (isAbortLike(error)) {
        throw error;
      }
      // Network/client errors are treated as temporary allow-all rather than
      // server-directed denial because they can be local connectivity glitches,
      // DNS/transient socket failures, or offline operation. The result is not
      // cached, so a later request will retry robots.txt instead of preserving
      // this fallback. HTTP 5xx responses above are different: the origin
      // answered but robots.txt is temporarily unavailable, so we fail closed.
      return { rules: allowAllRules(), fetchedAt: Date.now(), cacheable: false };
    }
  }
}

export function robotsUrlFor(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}

export function parseRobots(robotsUrl: string, body: string): RobotsRules {
  const parser = robotsParser(robotsUrl, body);
  return {
    isAllowed: (url, userAgent = DEFAULT_USER_AGENT) => parser.isAllowed(url, userAgent) !== false,
    crawlDelay: (userAgent = DEFAULT_USER_AGENT) => {
      const seconds = parser.getCrawlDelay(userAgent);
      return typeof seconds === "number" && Number.isFinite(seconds) ? seconds * 1_000 : undefined;
    },
    sitemaps: () => parser.getSitemaps(),
  };
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError" ||
    typeof error === "object" && error !== null &&
      "structured" in error &&
      (error as { structured?: { code?: string } }).structured?.code === "ABORTED";
}

function allowAllRules(): RobotsRules {
  return {
    isAllowed: () => true,
    crawlDelay: () => undefined,
    sitemaps: () => [],
  };
}

function disallowAllRules(): RobotsRules {
  return {
    isAllowed: () => false,
    crawlDelay: () => undefined,
    sitemaps: () => [],
  };
}
