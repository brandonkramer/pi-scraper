/** @file Public compatibility and deferred-tool documentation contract. */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
	readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");

interface PackageContract {
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

describe("public documentation contract", () => {
	it("keeps README compatibility and commands aligned with package metadata", () => {
		const readme = read("README.md");
		expect(readme).toContain("pi-%3E%3D0.81.0");
		expect(readme).toContain("**Pi**: `>=0.81.0`");
		expect(readme).toContain("bun run typecheck");
		expect(readme).not.toContain("npm run typecheck");
	});

	it("documents deferred discovery and trusted project manifests", () => {
		const readme = read("README.md");
		const skill = read("skills/web-scraping/SKILL.md");
		const customVerticals = read("skills/web-scraping/references/verticals/custom.md");

		expect(readme).toContain("`web_tools` progressively enables");
		expect(skill).toContain('web_tools query="<capability>"');
		expect(customVerticals).toContain("only for a trusted project");
	});

	it("keeps Pi-bundled core modules as host-supplied peers", () => {
		const manifest = JSON.parse(read("package.json")) as PackageContract;
		const corePeers = [
			"@earendil-works/pi-ai",
			"@earendil-works/pi-coding-agent",
			"@earendil-works/pi-tui",
			"typebox",
		];

		for (const dependency of corePeers) {
			expect(manifest.peerDependencies?.[dependency]).toBe("*");
			expect(manifest.dependencies?.[dependency]).toBeUndefined();
		}
	});
});
