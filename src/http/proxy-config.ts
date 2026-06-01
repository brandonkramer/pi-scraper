/** @file Env-var proxy auto-config module. */

/**
 * Resolve a proxy URL for the given input from standard environment variables.
 *
 * Priority:
 *
 * - https://…: `HTTPS_PROXY` → `https_proxy` → `ALL_PROXY` → `all_proxy`
 * - http://… : `HTTP_PROXY` → `http_proxy` → `ALL_PROXY` → `all_proxy`
 *
 * Explicit `proxy` parameter always wins; this is only called when none is provided.
 */
export function resolveEnvProxyForUrl(
	input: string | URL,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const url = typeof input === "string" ? new URL(input) : input;
	const isHttps = url.protocol === "https:";

	const candidates = isHttps
		? [env.HTTPS_PROXY, env.https_proxy, env.ALL_PROXY, env.all_proxy]
		: [env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy];

	for (const candidate of candidates) {
		if (candidate && candidate.length > 0) {
			if (shouldBypassProxy(url, env.NO_PROXY ?? env.no_proxy)) return undefined;
			return candidate;
		}
	}
	return undefined;
}

/**
 * Decide whether a URL should bypass the proxy based on a `NO_PROXY` value.
 *
 * Rules (from curl / standard conventions):
 *
 * - `*` bypasses everything.
 * - Comma-separated list, case-insensitive.
 * - `example.com` matches `example.com` and `foo.example.com`.
 * - `.example.com` matches the same.
 * - `host:port` only matches identical host+port.
 * - IPv6 hosts work with or without brackets.
 */
export function shouldBypassProxy(input: string | URL, noProxyValue: string | undefined): boolean {
	if (!noProxyValue || noProxyValue.length === 0) return false;

	const url = typeof input === "string" ? new URL(input) : input;
	const hostname = normalizeHost(url.hostname);
	const explicitPort = url.port;

	for (const entry of noProxyValue.split(",")) {
		const rule = entry.trim();
		if (rule.length === 0) continue;
		if (rule === "*") return true;

		// Port-scoped rule: "host:port" (exact port only, not default port)
		const colonIdx = rule.lastIndexOf(":");
		if (colonIdx > 0 && !rule.endsWith("]") && rule.indexOf(":") === colonIdx) {
			const rulePort = rule.slice(colonIdx + 1);
			if (/^\d+$/u.test(rulePort)) {
				const ruleHost = rule.slice(0, colonIdx);
				if (hostMatches(ruleHost, hostname) && rulePort === explicitPort) return true;
				continue;
			}
		}

		if (hostMatches(rule, hostname)) return true;
	}

	return false;
}

function normalizeHost(hostname: string): string {
	// Strip IPv6 brackets
	if (hostname.startsWith("[") && hostname.endsWith("]")) {
		return hostname.slice(1, -1);
	}
	return hostname;
}

function hostMatches(rule: string, hostname: string): boolean {
	let lowerRule = rule.toLowerCase();
	const lowerHost = hostname.toLowerCase();

	// Strip IPv6 brackets from rule for comparison
	if (lowerRule.startsWith("[") && lowerRule.endsWith("]")) {
		lowerRule = lowerRule.slice(1, -1);
	}

	if (lowerRule === lowerHost) return true;

	// Strip leading dot for wildcard matching
	const domain = lowerRule.startsWith(".") ? lowerRule.slice(1) : lowerRule;
	if (lowerHost === domain) return true;
	if (lowerHost.endsWith(`.${domain}`)) return true;

	return false;
}
