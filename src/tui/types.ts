import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

/**
 * Minimal theme hooks consumed by pi-scraper TUI render helpers.
 *
 * Renderers must tolerate any hook being absent and fall back to plain text.
 */
export type RenderTheme = Partial<Pick<Theme, "fg" | "bg" | "bold">>;
export type ThemeColorName = Parameters<NonNullable<RenderTheme["fg"]>>[0];
export type ThemeBackgroundName = Parameters<NonNullable<RenderTheme["bg"]>>[0];

/** Pi TUI component returned by all tool renderer helpers. */
export type RenderComponent = Component;
