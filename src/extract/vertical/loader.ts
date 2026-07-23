/**
 * @file Vertical manifest loader — reads YAML/JSONC vertical manifests from package, project, and
 *   user roots.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { resolvePiStoragePaths } from "../../storage/paths.ts";
import type { ManifestDiagnostic, ManifestSource, VerticalManifest } from "./manifest-types.ts";
import { isManifestValid, validateManifest } from "./validate.ts";

export interface LayeredManifestLoadResult {
	packageManifests: VerticalManifest[];
	globalManifests: VerticalManifest[];
	projectManifests: VerticalManifest[];
	errors: ManifestDiagnostic[];
}

export interface LayeredManifestLoadOptions {
	includeProject?: boolean;
	projectTrusted?: boolean;
	cwd?: string;
}

interface ManifestLoadResult {
	manifests: VerticalManifest[];
	errors: ManifestDiagnostic[];
}

/** Load manifests in precedence layers: package < global user < project. */
export async function loadLayeredManifests(
	options: LayeredManifestLoadOptions = {},
): Promise<LayeredManifestLoadResult> {
	const includeProject = options.includeProject ?? true;
	const projectTrusted = options.projectTrusted ?? false;
	const cwd = options.cwd ?? process.cwd();
	const packageResult = await loadManifestsFromDirectory(resolvePackageVerticalsDir(), "builtin");
	const globalResult = await loadManifestsFromDirectory(
		path.join(resolvePiStoragePaths().root, "verticals"),
		"user",
	);
	const projectResult =
		includeProject && projectTrusted
			? await loadManifestsFromDirectory(path.join(cwd, ".pi", "scraper", "verticals"), "project")
			: { manifests: [], errors: [] };

	return {
		packageManifests: packageResult.manifests,
		globalManifests: globalResult.manifests,
		projectManifests: projectResult.manifests,
		errors: [...packageResult.errors, ...globalResult.errors, ...projectResult.errors],
	};
}

/** Root-level package manifests live at pi-scraper/verticals/*.yaml. */
function resolvePackageVerticalsDir(): string {
	return path.resolve(import.meta.dirname, "../../../verticals");
}

async function loadManifestsFromDirectory(
	dir: string,
	source: ManifestSource,
): Promise<ManifestLoadResult> {
	const manifests: VerticalManifest[] = [];
	const errors: ManifestDiagnostic[] = [];

	let files: string[];
	try {
		files = await readdir(dir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { manifests, errors };
		throw error;
	}

	const manifestFiles = files.filter((file) => isManifestFile(file)).toSorted();
	for (const file of manifestFiles) {
		const filePath = path.join(dir, file);
		try {
			const text = await readFile(filePath, "utf8");
			const parsed = parseManifestText(text, file);
			const { manifest, diagnostics } = validateManifest(parsed, source, filePath);
			manifest.diagnostics = diagnostics;
			if (isManifestValid(manifest)) {
				manifests.push(manifest);
			} else {
				errors.push(
					...diagnostics
						.filter((d) => d.severity === "error")
						.map((d) => ({ ...d, source: filePath })),
				);
			}
		} catch (error) {
			errors.push({
				severity: "error",
				message: `Failed to parse ${file}: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	return { manifests: sortManifests(manifests), errors };
}

function isManifestFile(file: string): boolean {
	return (
		file.endsWith(".yaml") ||
		file.endsWith(".yml") ||
		file.endsWith(".jsonc") ||
		file.endsWith(".json")
	);
}

function sortManifests(manifests: VerticalManifest[]): VerticalManifest[] {
	return manifests.toSorted((a, b) => {
		const ao = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
		const bo = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
		if (ao !== bo) return ao - bo;
		return a.name.localeCompare(b.name);
	});
}

export function parseManifestText(text: string, fileName: string): unknown {
	return fileName.endsWith(".yaml") || fileName.endsWith(".yml")
		? parseYamlManifest(text)
		: parseJsonc(text);
}

export function parseYamlManifest(text: string): unknown {
	return parseYaml(text, {
		maxAliasCount: 0,
		prettyErrors: false,
		schema: "core",
		strict: true,
		uniqueKeys: true,
	});
}

/**
 * Parse JSONC by stripping comments before JSON.parse. String-aware: does not remove "//" or "/*"
 * inside string literals.
 */
export function parseJsonc(text: string): unknown {
	const result: string[] = [];
	let i = 0;
	while (i < text.length) {
		// Inside a string literal — copy verbatim past the closing quote
		if (text[i] === '"') {
			const start = i;
			i++;
			while (i < text.length) {
				if (text[i] === "\\") i += 2;
				else if (text[i] === '"') {
					i++;
					break;
				} else i++;
			}
			result.push(text.slice(start, i));
			continue;
		}
		// Line comment
		if (text[i] === "/" && text[i + 1] === "/") {
			i += 2;
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}
		// Block comment
		if (text[i] === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		result.push(text[i] ?? "");
		i++;
	}
	// Strip trailing commas before ] or } (JSONC feature)
	const stripped = result.join("").replaceAll(/,\s*([\]}])/gu, "$1");
	return JSON.parse(stripped);
}
