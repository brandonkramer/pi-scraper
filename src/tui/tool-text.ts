/** Re-export adapter: theme and text render helpers. */
export { renderText as toolText } from "./tool-call.ts";
export {
	neutral as toolNeutral,
	muted as toolMuted,
	success as toolSuccess,
	failure as toolFailure,
	separator as toolSeparator,
	joinSegments as toolJoinSegments,
	getMarkdownTheme as toolMarkdownTheme,
	activity as toolActivity,
} from "./theme.ts";
