/**
 * @fileoverview Tool-name allowlist for unicode glyph rendering — kept in tools/ because it's hard-coded tool-domain knowledge.
 */

export function toolAllowsIcons(toolName: `web_${string}`): boolean {
	return toolName === "web_batch" || toolName === "web_crawl";
}
