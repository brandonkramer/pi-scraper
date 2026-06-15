/** @file URL matcher for vertical manifests. */
import type { VerticalManifest } from "./manifest-types.ts";

type Values = Record<string, string>;

export function matchManifestUrl(
	manifest: Pick<VerticalManifest, "urlPatterns" | "matchOptions">,
	url: URL,
): Record<string, string> | undefined {
	const captures = matchUrlPattern(url, manifest.urlPatterns);
	if (!captures) return;
	return applyMatchOptions(url, captures, manifest.matchOptions);
}

export function matchUrlPattern(url: URL, patterns: string[]): Record<string, string> | undefined {
	for (const pattern of patterns) {
		const match = tryMatchPattern(url, pattern);
		if (match) return match;
	}
}

function tryMatchPattern(url: URL, pattern: string): Record<string, string> | undefined {
	const parsed = parseUrlPattern(pattern);
	if (!parsed) return;
	const hostCaptures = matchHostPattern(parsed.host, url.hostname);
	if (!hostCaptures) return;
	const patternSegments = parsed.pathname.split("/").filter(Boolean);
	const urlSegments = url.pathname.split("/").filter(Boolean);
	const captures = matchSegments(patternSegments, urlSegments);
	if (!captures) return;
	const merged = { ...hostCaptures, ...captures };
	for (const [key, value] of url.searchParams) merged[key] = value;
	return merged;
}

function parseUrlPattern(pattern: string): { host: string; pathname: string } | undefined {
	const match = /^(?:https?):\/\/([^/?#]+)([^?#]*)/u.exec(pattern);
	if (!match?.[1]) return;
	return { host: match[1].toLowerCase(), pathname: match[2] || "/" };
}

function matchHostPattern(hostPattern: string, hostname: string): Values | undefined {
	const host = hostname.toLowerCase();
	if (hostPattern.startsWith(":")) {
		const capture = hostPattern.slice(1);
		const subdomainCapture = /^([A-Za-z][\w-]*)\.(.+)$/u.exec(capture);
		if (subdomainCapture) {
			const [, name, suffix] = subdomainCapture;
			if (!host.endsWith(`.${suffix}`) || host.length <= suffix.length + 1) return;
			const subdomain = host.slice(0, host.length - suffix.length - 1);
			if (!subdomain || subdomain.includes(".")) return;
			return { [name]: subdomain };
		}
		return { [capture]: host };
	}
	if (hostPattern.startsWith("*.")) {
		const suffix = hostPattern.slice(1);
		return host.endsWith(suffix) && host.length > suffix.length ? {} : undefined;
	}
	return hostPattern === host ? {} : undefined;
}

function matchSegments(patternSegments: string[], urlSegments: string[]): Values | undefined {
	function walk(patternIndex: number, urlIndex: number): Values | undefined {
		if (patternIndex === patternSegments.length && urlIndex === urlSegments.length) return {};
		if (patternIndex >= patternSegments.length) return;
		const pattern = patternSegments[patternIndex];
		if (!pattern) return;
		const spread = spreadCapture(pattern);
		if (spread)
			return matchSpread(spread, patternSegments, urlSegments, patternIndex, urlIndex, walk);
		if (urlIndex >= urlSegments.length) return;
		const current = urlSegments[urlIndex];
		const rest = walk(patternIndex + 1, urlIndex + 1);
		if (!rest) return;
		if (pattern.startsWith(":") && pattern.length > 1) {
			return { [pattern.slice(1)]: decodeURIComponent(current), ...rest };
		}
		return pattern === current ? rest : undefined;
	}
	return walk(0, 0);
}

function matchSpread(
	spread: { key: string; operator: "*" | "+"; suffix: string },
	patternSegments: string[],
	urlSegments: string[],
	patternIndex: number,
	urlIndex: number,
	walk: (patternIndex: number, urlIndex: number) => Values | undefined,
): Values | undefined {
	const remainingPatternCount = patternSegments.length - patternIndex - 1;
	const maxEnd = urlSegments.length - remainingPatternCount;
	const minEnd = urlIndex + (spread.operator === "+" ? 1 : 0);
	for (let end = minEnd; end <= maxEnd; end++) {
		const value = urlSegments
			.slice(urlIndex, end)
			.map((segment) => decodeURIComponent(segment))
			.join("/");
		if (spread.suffix && !value.endsWith(spread.suffix)) continue;
		const rest = walk(patternIndex + 1, end);
		if (rest) return { [spread.key]: value, ...rest };
	}
}

function spreadCapture(
	pattern: string,
): { key: string; operator: "*" | "+"; suffix: string } | undefined {
	const match = /^:([A-Za-z][\w-]*)([*+])(.*)$/u.exec(pattern);
	if (!match?.[1] || !match[2]) return;
	return { key: match[1], operator: match[2] as "*" | "+", suffix: match[3] };
}

export function applyMatchOptions(
	url: URL,
	captures: Values,
	options: VerticalManifest["matchOptions"],
): Values | undefined {
	const values: Values = { ...options?.defaults, ...captures };
	for (const [name, query] of Object.entries(options?.query ?? {})) {
		const value = url.searchParams.get(query.from ?? name) ?? query.default;
		if (value !== undefined) values[name] = value;
		if (value !== undefined && query.enum && !query.enum.includes(value)) return;
	}
	for (const [name, rejected] of Object.entries(options?.exclude ?? {})) {
		const value = values[name] ?? "";
		if (rejected.some((item) => value === item || value.startsWith(`${item}/`))) return;
	}
	return values;
}
