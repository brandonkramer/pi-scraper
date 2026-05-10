/**
 * @fileoverview Reusable Pi terminal UI rendering contracts.
 *
 * These types define the boundary between TUI primitives and tool-specific
 * composition. Tool adapters import these for renderer signatures while
 * keeping tool-execution and tool-adapter contracts separate.
 */
import type { Component } from "@earendil-works/pi-tui";

export interface RenderTheme {
	fg?: (name: string, text: string) => string;
	bg?: (name: string, text: string) => string;
	bold?: (text: string) => string;
}

/**
 * Re-export of pi-tui's Component type for custom tool renderers.
 *
 * @remarks
 * Pi's interactive renderer calls `child.render(width)` on custom render output;
 * returning plain strings crashes the TUI. Using the native Component type
 * avoids duplication and stays aligned with the runtime contract.
 */
export type RenderComponent = Component;
