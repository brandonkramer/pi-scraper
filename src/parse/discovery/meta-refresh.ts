/** @file Meta-refresh discovery module. */

import type { DomAdapter } from "../dom/adapter.ts";

export interface MetaRefresh {
	delaySeconds: number;
	url: string;
}

/**
 * Parse the `<meta http-equiv="refresh" content="...">` tag if present. Returns undefined when no
 * valid refresh directive is found.
 *
 * @remarks
 *   Format per WHATWG HTML spec §4.2.5.3: - `content` attribute is `delay; url=target` or just
 *   `delay; URL=target` (case-insensitive) - Delay must be a non-negative integer or float - URL
 *   resolves against the document base - Multiple refresh tags: first wins (per HTML5 spec)
 */
export function discoverMetaRefresh(dom: DomAdapter, baseUrl: string): MetaRefresh | undefined {
	const selection = dom.select('meta[http-equiv="refresh"], meta[http-equiv="Refresh"]');
	for (const node of dom.nodes(selection)) {
		const content = dom.attr(node, "content");
		if (!content) continue;
		const parsed = parseMetaRefreshContent(content, baseUrl);
		if (parsed) return parsed;
	}
	return undefined;
}

function parseMetaRefreshContent(content: string, baseUrl: string): MetaRefresh | undefined {
	const trimmed = content.trim();
	if (!trimmed) return undefined;

	// Pattern: delay; url=target  (case-insensitive URL=)
	const match = trimmed.match(
		/^(?<delay>[0-9]*\.?[0-9]+)\s*;\s*(?:url\s*=\s*|URL\s*=\s*)(?<url>.+)$/iu,
	);
	if (match?.groups?.delay && match.groups.url) {
		const delay = Number.parseFloat(match.groups.delay);
		if (!Number.isFinite(delay) || delay < 0) return undefined;
		const resolved = resolveUrl(match.groups.url.trim(), baseUrl);
		if (resolved) return { delaySeconds: delay, url: resolved };
	}

	// Just a delay number with no URL — not a redirect
	const delayOnly = trimmed.match(/^(?<delay>[0-9]*\.?[0-9]+)\s*$/u);
	if (delayOnly?.groups?.delay) return undefined;

	// Some older forms omit the semicolon: "0 url=/target"
	const spaceForm = trimmed.match(/^(?<delay>[0-9]*\.?[0-9]+)\s+url\s*=\s*(?<url>.+)$/iu);
	if (spaceForm?.groups?.delay && spaceForm.groups.url) {
		const delay = Number.parseFloat(spaceForm.groups.delay);
		if (!Number.isFinite(delay) || delay < 0) return undefined;
		const resolved = resolveUrl(spaceForm.groups.url.trim(), baseUrl);
		if (resolved) return { delaySeconds: delay, url: resolved };
	}

	return undefined;
}

function resolveUrl(url: string, baseUrl: string): string | undefined {
	try {
		return new URL(url, baseUrl).href;
	} catch {
		return undefined;
	}
}
