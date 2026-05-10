/**
 * @fileoverview extract verticals huggingface module.
 */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

interface HuggingFaceModelApi {
	id?: string;
	modelId?: string;
	author?: string;
	pipeline_tag?: string;
	tags?: string[];
	downloads?: number;
	likes?: number;
	private?: boolean;
	gated?: boolean | string;
	createdAt?: string;
	lastModified?: string;
	cardData?: Record<string, unknown>;
}

interface HuggingFaceDatasetApi {
	id?: string;
	author?: string;
	tags?: string[];
	downloads?: number;
	likes?: number;
	private?: boolean;
	gated?: boolean | string;
	createdAt?: string;
	lastModified?: string;
	cardData?: Record<string, unknown>;
}

const reservedModelRoots = new Set([
	"datasets",
	"spaces",
	"docs",
	"models",
	"organizations",
	"pricing",
	"login",
	"join",
]);

export const huggingFaceModelExtractor: VerticalExtractor = {
	capability: capability(
		"huggingface_model",
		["https://huggingface.co/:owner/:model"],
		{
			type: "object",
			required: ["id"],
			properties: {
				id: { type: "string" },
				author: { type: "string" },
				pipelineTag: { type: "string" },
				downloads: { type: "number" },
				likes: { type: "number" },
			},
		},
	),
	match: (url) => {
		if (url.hostname !== "huggingface.co") return undefined;
		const [owner, name, ...rest] = url.pathname.split("/").filter(Boolean);
		if (!owner || !name || rest.length > 0 || reservedModelRoots.has(owner))
			return undefined;
		return { id: `${owner}/${name}` };
	},
	extract: async (_url, match, context, signal) => {
		const model = await context.fetchJson<HuggingFaceModelApi>(
			`https://huggingface.co/api/models/${encodeRepoId(match.id)}`,
			signal,
		);
		return {
			id: model.modelId ?? model.id ?? match.id,
			author: model.author,
			pipelineTag: model.pipeline_tag,
			tags: model.tags,
			downloads: model.downloads,
			likes: model.likes,
			private: model.private,
			gated: model.gated,
			createdAt: model.createdAt,
			updatedAt: model.lastModified,
			cardData: model.cardData,
		};
	},
};

export const huggingFaceDatasetExtractor: VerticalExtractor = {
	capability: capability(
		"huggingface_dataset",
		["https://huggingface.co/datasets/:owner/:dataset"],
		{
			type: "object",
			required: ["id"],
			properties: {
				id: { type: "string" },
				author: { type: "string" },
				downloads: { type: "number" },
				likes: { type: "number" },
			},
		},
	),
	match: (url) => {
		if (url.hostname !== "huggingface.co") return undefined;
		const [datasets, owner, name, ...rest] = url.pathname
			.split("/")
			.filter(Boolean);
		if (datasets !== "datasets" || !owner || !name || rest.length > 0)
			return undefined;
		return { id: `${owner}/${name}` };
	},
	extract: async (_url, match, context, signal) => {
		const dataset = await context.fetchJson<HuggingFaceDatasetApi>(
			`https://huggingface.co/api/datasets/${encodeRepoId(match.id)}`,
			signal,
		);
		return {
			id: dataset.id ?? match.id,
			author: dataset.author,
			tags: dataset.tags,
			downloads: dataset.downloads,
			likes: dataset.likes,
			private: dataset.private,
			gated: dataset.gated,
			createdAt: dataset.createdAt,
			updatedAt: dataset.lastModified,
			cardData: dataset.cardData,
		};
	},
};

function encodeRepoId(id: string): string {
	return id.split("/").map(encodeURIComponent).join("/");
}
