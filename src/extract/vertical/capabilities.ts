/** @file Extract capabilities module. */
import type { ExtractorCapability } from "../../types.ts";
export type * from "./types.ts";

export function capability(
	name: string,
	urlPatterns: string[],
	schema: unknown,
	requirements: Partial<
		Pick<ExtractorCapability, "requiresBrowser" | "requiresLLM" | "requiresCloud">
	> = {},
): ExtractorCapability {
	return {
		name,
		urlPatterns,
		requiresBrowser: requirements.requiresBrowser ?? false,
		requiresLLM: requirements.requiresLLM ?? false,
		requiresCloud: requirements.requiresCloud ?? false,
		schema,
	};
}
