/**
 * @fileoverview extract verticals npm module.
 */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

interface NpmLatestPackage {
	name: string;
	version?: string;
	description?: string;
	license?: string;
	homepage?: string;
}

export const npmPackageExtractor: VerticalExtractor = {
	capability: capability(
		"npm",
		[
			"https://www.npmjs.com/package/:name",
			"https://www.npmjs.com/package/:name/v/:version",
			"https://npmjs.com/package/:name",
			"https://npmjs.com/package/:name/v/:version",
			"https://npmx.dev/package/:name",
			"https://npmx.dev/package/:name/v/:version",
		],
		{
			type: "object",
			required: ["name"],
			properties: {
				name: { type: "string" },
				version: { type: "string" },
				latestVersion: { type: "string" },
				requestedVersion: { type: "string" },
			},
		},
	),
	match: (url) => {
		if (
			url.hostname !== "www.npmjs.com" &&
			url.hostname !== "npmjs.com" &&
			url.hostname !== "npmx.dev"
		)
			return undefined;
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts[0] !== "package") return undefined;
		const scoped = parts[1]?.startsWith("@");
		const name = scoped ? `${parts[1]}/${parts[2] ?? ""}` : parts[1];
		const versionMarker = scoped ? parts[3] : parts[2];
		const version =
			versionMarker === "v" ? (scoped ? parts[4] : parts[3]) : undefined;
		return name ? { name, ...(version ? { version } : {}) } : undefined;
	},
	extract: async (_url, match, context, signal) => {
		const encodedName = encodeURIComponent(match.name).replace(/%2F/gu, "/");
		const versionPath = encodeURIComponent(match.version ?? "latest");
		const pkg = await context.fetchJson<NpmLatestPackage>(
			`https://registry.npmjs.org/${encodedName}/${versionPath}`,
			signal,
		);
		return {
			name: pkg.name,
			description: pkg.description,
			version: pkg.version,
			latestVersion: match.version ? undefined : pkg.version,
			requestedVersion: match.version,
			homepage: pkg.homepage,
			license: pkg.license,
		};
	},
};
