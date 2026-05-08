/**
 * @fileoverview env.d module.
 */
declare module "turndown-plugin-gfm" {
	import type TurndownService from "turndown";

	export type TurndownPlugin = (service: TurndownService) => void;

	export const gfm: TurndownPlugin;
	export const highlightedCodeBlock: TurndownPlugin;
	export const strikethrough: TurndownPlugin;
	export const tables: TurndownPlugin;
	export const taskListItems: TurndownPlugin;

	const plugins: {
		gfm: TurndownPlugin;
		highlightedCodeBlock: TurndownPlugin;
		strikethrough: TurndownPlugin;
		tables: TurndownPlugin;
		taskListItems: TurndownPlugin;
	};

	export default plugins;
}
