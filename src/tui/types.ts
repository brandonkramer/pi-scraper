/** @file Public TUI component type exports. Individual TUI component types. */
import type { Component } from "@earendil-works/pi-tui";

/** Subset of Pi's Theme palette using plain string names; supports custom bg slots like toolErrorBg. */
export interface RenderTheme {
	fg?: (name: string, text: string) => string;
	bg?: (name: string, text: string) => string;
	bold?: (text: string) => string;
}

/** Re-export of pi-tui's Component for custom tool renderers. */
export type RenderComponent = Component;
