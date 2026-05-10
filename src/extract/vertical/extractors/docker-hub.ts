/**
 * @fileoverview extract verticals docker-hub module.
 */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

interface DockerHubRepository {
	namespace?: string;
	name: string;
	repository_type?: string;
	description?: string;
	star_count?: number;
	pull_count?: number;
	is_private?: boolean;
	last_updated?: string;
	date_registered?: string;
	user?: string;
}

export const dockerHubExtractor: VerticalExtractor = {
	capability: capability(
		"docker_hub",
		[
			"https://hub.docker.com/r/:namespace/:repo",
			"https://hub.docker.com/_/:repo",
		],
		{
			type: "object",
			required: ["namespace", "name"],
			properties: {
				namespace: { type: "string" },
				name: { type: "string" },
				pulls: { type: "number" },
				stars: { type: "number" },
			},
		},
	),
	match: (url) => {
		if (url.hostname !== "hub.docker.com") return undefined;
		const [scope, first, second, ...rest] = url.pathname
			.split("/")
			.filter(Boolean);
		if (scope === "_" && first && !second && rest.length === 0)
			return { namespace: "library", repo: first };
		if (scope === "r" && first && second && rest.length === 0)
			return { namespace: first, repo: second };
		return undefined;
	},
	extract: async (_url, match, context, signal) => {
		const repo = await context.fetchJson<DockerHubRepository>(
			`https://hub.docker.com/v2/repositories/${match.namespace}/${match.repo}/`,
			signal,
		);
		return {
			namespace: repo.namespace ?? match.namespace,
			name: repo.name,
			type: repo.repository_type,
			description: repo.description,
			stars: repo.star_count,
			pulls: repo.pull_count,
			private: repo.is_private,
			owner: repo.user,
			createdAt: repo.date_registered,
			updatedAt: repo.last_updated,
		};
	},
};
