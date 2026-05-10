/**
 * @fileoverview Selector extraction public entrypoint.
 */
export { extractFromSelectorResult } from "./css.ts";
export {
	runSelectorExtraction,
	type SelectorRunParams,
	type SelectorRunResult,
} from "./runner.ts";
export {
	evaluateJsonPaths,
	flattenJsonValues,
	isSupportedJsonPath,
	parseJsonSafe,
} from "./json-path.ts";
export type {
	SelectorExtractionOptions,
	SelectorExtractionMatch,
	SelectorExtractionResult,
} from "./types.ts";
