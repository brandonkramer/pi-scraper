import type { Component } from "@earendil-works/pi-tui";

/**
 * Minimal theme hooks consumed by pi-scraper TUI render helpers.
 *
 * Renderers must tolerate any hook being absent and fall back to plain text.
 */
export interface RenderTheme {
	fg?: (name: string, text: string) => string;
	bg?: (name: string, text: string) => string;
	bold?: (text: string) => string;
}

/** Pi TUI component returned by all tool renderer helpers. */
export type RenderComponent = Component;
