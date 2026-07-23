/** @file Project manifest trust, cwd, and cache-scope tests. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildManifestRegistry,
	clearManifestRegistryCache,
} from "../../vertical/manifest-registry.ts";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-manifest-trust-"));
	clearManifestRegistryCache();
});

afterEach(async () => {
	clearManifestRegistryCache();
	await rm(rootDir, { recursive: true, force: true });
});

async function writeProjectManifest(cwd: string, description: string): Promise<void> {
	const dir = path.join(cwd, ".pi", "scraper", "verticals");
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "project_test.json"),
		JSON.stringify({
			version: 1,
			name: "project_test",
			kind: "api-json",
			description,
			urlPatterns: ["https://example.com/:id"],
			request: { urlTemplate: "https://api.example.com/{{id}}" },
			extract: { id: "$.id" },
		}),
		"utf8",
	);
}

describe("project manifest boundaries", () => {
	it("does not load project manifests for an untrusted session", async () => {
		const cwd = path.join(rootDir, "untrusted");
		await writeProjectManifest(cwd, "must stay hidden");

		const registry = await buildManifestRegistry({
			includeProject: true,
			projectTrusted: false,
			cwd,
		});

		expect(registry.get("project_test")).toBeUndefined();
	});

	it("keys trusted project manifests by the session cwd", async () => {
		const first = path.join(rootDir, "first");
		const second = path.join(rootDir, "second");
		await writeProjectManifest(first, "first project");
		await writeProjectManifest(second, "second project");

		const firstRegistry = await buildManifestRegistry({
			includeProject: true,
			projectTrusted: true,
			cwd: first,
		});
		const secondRegistry = await buildManifestRegistry({
			includeProject: true,
			projectTrusted: true,
			cwd: second,
		});

		expect(firstRegistry.get("project_test")?.manifest.description).toBe("first project");
		expect(secondRegistry.get("project_test")?.manifest.description).toBe("second project");
	});

	it("reloads changed project manifests after session cache invalidation", async () => {
		const cwd = path.join(rootDir, "reload");
		await writeProjectManifest(cwd, "before reload");
		const options = { includeProject: true, projectTrusted: true, cwd };

		const before = await buildManifestRegistry(options);
		await writeProjectManifest(cwd, "after reload");
		const cached = await buildManifestRegistry(options);
		clearManifestRegistryCache();
		const reloaded = await buildManifestRegistry(options);

		expect(before.get("project_test")?.manifest.description).toBe("before reload");
		expect(cached.get("project_test")?.manifest.description).toBe("before reload");
		expect(reloaded.get("project_test")?.manifest.description).toBe("after reload");
	});
});
