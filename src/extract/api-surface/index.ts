/**
 * @fileoverview API-surface extraction public entrypoint.
 */
export type {
	ApiSurfaceParameter,
	ApiSurfaceFunction,
	ApiSurfaceClass,
	ApiSurfaceModule,
	ApiSurfaceTree,
	ApiSurfaceInputPage,
	SymbolIncludeType,
	ExtractSchemaPreset,
	SymbolIncludeFilter,
	SymbolSelectionOptions,
	SelectedSection,
	SelectedCodeBlock,
	SelectedTable,
	SelectedSymbol,
	SymbolSelectionResult,
} from "./types.ts";
export { buildApiSurface, buildApiSurfaceFromScrapes } from "./tree.ts";
export {
	runApiSurfaceFromInput,
	type ApiSurfaceInput,
	type ApiSurfaceRunResult,
} from "./runner.ts";
export { selectSymbolContent } from "./selection.ts";
