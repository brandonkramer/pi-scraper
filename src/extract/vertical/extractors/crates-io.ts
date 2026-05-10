/**
 * @fileoverview extract verticals crates-io module.
 */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

interface CratesIoResponse {
	crate: {
		id: string;
		name: string;
		description?: string;
		homepage?: string;
		repository?: string;
		documentation?: string;
		max_version?: string;
		downloads?: number;
		recent_downloads?: number;
		license?: string;
		created_at?: string;
		updated_at?: string;
	};
}

export const cratesIoExtractor: VerticalExtractor = {
	capability: capability("crates_io", ["https://crates.io/crates/:name"], {
		type: "object",
		required: ["name", "latestVersion"],
		properties: {
			name: { type: "string" },
			latestVersion: { type: "string" },
			downloads: { type: "number" },
		},
	}),
	match: (url) => {
		if (url.hostname !== "crates.io") return undefined;
		const [crates, name, ...rest] = url.pathname.split("/").filter(Boolean);
		return crates === "crates" && name && rest.length === 0
			? { name }
			: undefined;
	},
	extract: async (_url, match, context, signal) => {
		const response = await context.fetchJson<CratesIoResponse>(
			`https://crates.io/api/v1/crates/${encodeURIComponent(match.name)}`,
			signal,
		);
		const item = response.crate;
		return {
			id: item.id,
			name: item.name,
			description: item.description,
			latestVersion: item.max_version,
			homepage: item.homepage,
			repository: item.repository,
			documentation: item.documentation,
			downloads: item.downloads,
			recentDownloads: item.recent_downloads,
			license: item.license,
			createdAt: item.created_at,
			updatedAt: item.updated_at,
		};
	},
};
