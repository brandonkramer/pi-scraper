import path from "node:path";

import { loadLayeredManifests } from "./loader.ts";
import type { ManifestDiagnostic, ManifestSource, VerticalManifest } from "./manifest-types.ts";
/** @file Manifest registry — merges package, global, and project vertical manifests. */
import { matchManifestUrl } from "./matcher.ts";
import { isManifestValid } from "./validate.ts";

export interface ManifestRegistryEntry {
	manifest: VerticalManifest;
	/** Source of the active manifest. Precedence: project > user > builtin package. */
	activeSource: ManifestSource;
	/** If true, this entry is served by a declarative runtime. */
	isDeclarative: boolean;
	/** If the active manifest replaced a lower-priority manifest. */
	overridden?: boolean;
	/** Override diagnostics (for action=list visibility). */
	diagnostics: ManifestDiagnostic[];
}

export interface ManifestRegistry {
	entries: ManifestRegistryEntry[];
	/** All load-time errors and warnings. */
	errors: ManifestDiagnostic[];
	/** Find an entry by name. */
	get(name: string): ManifestRegistryEntry | undefined;
	/** Find a manifest that matches the URL. */
	match(url: URL): { entry: ManifestRegistryEntry; captures: Record<string, string> } | undefined;
}

export interface ManifestRegistryOptions {
	includeProject?: boolean;
	projectTrusted?: boolean;
	cwd?: string;
}

const registryCache = new Map<string, Promise<ManifestRegistry>>();

export async function buildManifestRegistry(
	input: boolean | ManifestRegistryOptions = {},
): Promise<ManifestRegistry> {
	const options = normalizeRegistryOptions(input);
	const includeProject = options.includeProject && options.projectTrusted;
	const projectRoot = includeProject ? pathKey(options.cwd) : "<project-disabled>";
	const cacheKey = `${includeProject ? "project" : "shared"}:${projectRoot}`;
	let cached = registryCache.get(cacheKey);
	if (!cached) {
		cached = loadLayeredManifests({
			includeProject,
			projectTrusted: options.projectTrusted,
			cwd: options.cwd,
		}).then((layered) =>
			mergeManifests(
				layered.packageManifests,
				[...layered.globalManifests, ...layered.projectManifests],
				layered.errors,
			),
		);
		registryCache.set(cacheKey, cached);
		cached.catch(() => registryCache.delete(cacheKey));
	}
	return await cached;
}

export function clearManifestRegistryCache(): void {
	registryCache.clear();
}

function normalizeRegistryOptions(
	input: boolean | ManifestRegistryOptions,
): Required<ManifestRegistryOptions> {
	if (typeof input === "boolean") {
		return { includeProject: input, projectTrusted: input, cwd: process.cwd() };
	}
	const includeProject = input.includeProject ?? true;
	return {
		includeProject,
		projectTrusted: input.projectTrusted ?? false,
		cwd: input.cwd ?? process.cwd(),
	};
}

function pathKey(cwd: string): string {
	const normalized = path.resolve(cwd).replaceAll("\\", "/").replace(/\/$/u, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Merge manifests by ascending precedence. The first argument is the package layer; the second
 * argument contains higher-priority overlays in source order (global user, then project).
 */
export function mergeManifests(
	packageManifests: VerticalManifest[],
	overlayManifests: VerticalManifest[],
	loadErrors: ManifestDiagnostic[],
): ManifestRegistry {
	const byName = new Map<string, ManifestRegistryEntry>();
	const errors: ManifestDiagnostic[] = [...loadErrors];
	const orderedNames: string[] = [];

	for (const manifest of [...packageManifests, ...overlayManifests]) {
		if (!isManifestValid(manifest)) {
			errors.push(...(manifest.diagnostics ?? []));
			continue;
		}

		const existing = byName.get(manifest.name);
		if (!existing) orderedNames.push(manifest.name);
		byName.set(manifest.name, {
			manifest,
			activeSource: manifest.source ?? "user",
			isDeclarative: manifest.kind !== "builtin",
			overridden: Boolean(existing),
			diagnostics: manifest.diagnostics ?? [],
		});
	}

	const entries = orderedNames.flatMap((name) => {
		const entry = byName.get(name);
		return entry ? [entry] : [];
	});

	return {
		entries,
		errors,
		get(name: string) {
			return byName.get(name);
		},
		match(url: URL) {
			for (const entry of entries) {
				const captures = matchManifestUrl(entry.manifest, url);
				if (captures) return { entry, captures };
			}
		},
	};
}

/** Return a lightweight capability-like summary for action=list. */
export function manifestToListItem(entry: ManifestRegistryEntry) {
	const m = entry.manifest;
	return {
		name: m.name,
		kind: m.kind,
		source: entry.activeSource,
		description: m.description,
		urlPatterns: m.urlPatterns,
		isDeclarative: entry.isDeclarative,
		overridden: entry.overridden,
		requirements: m.requirements,
		capabilities: m.capabilities,
		diagnostics: entry.diagnostics.length > 0 ? entry.diagnostics : undefined,
	};
}

export function listManifestExtractors(registry: ManifestRegistry) {
	return registry.entries.map((entry) => manifestToListItem(entry));
}
