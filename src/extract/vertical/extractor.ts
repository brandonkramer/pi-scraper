/** @file Manifest-driven vertical extractor factory. */
import type { VerticalExtractor } from "./capabilities.ts";
import { capability } from "./capabilities.ts";
import type { VerticalManifest } from "./manifest-types.ts";
import { matchManifestUrl } from "./matcher.ts";
import { runManifestExtraction } from "./run.ts";

export { extractJsonPath } from "./manifest-json-path.ts";
export { matchUrlPattern } from "./matcher.ts";

export function createManifestExtractor(manifest: VerticalManifest): VerticalExtractor {
	return {
		capability: manifestToCapability(manifest),
		match: (url) => matchManifestUrl(manifest, url),
		extract: (url, match, context, signal) =>
			runManifestExtraction(manifest, url, match, context, signal),
	};
}

function manifestToCapability(manifest: VerticalManifest) {
	return capability(
		manifest.name,
		manifest.urlPatterns,
		manifest.outputSchema ??
			(manifest.extract
				? {
						type: "object",
						properties: Object.fromEntries(
							Object.entries(manifest.extract).map(([key]) => [key, { type: "string" }]),
						),
					}
				: { type: "object" }),
		{
			requiresBrowser: manifest.requirements?.requiresBrowser ?? false,
			requiresLLM: manifest.requirements?.requiresLLM ?? false,
			requiresCloud: manifest.requirements?.requiresCloud ?? false,
		},
	);
}
