import type { Component } from "@earendil-works/pi-tui";

export interface RenderTheme {
	fg?: (name: string, text: string) => string;
	bg?: (name: string, text: string) => string;
	bold?: (text: string) => string;
}

export type RenderComponent = Component;
