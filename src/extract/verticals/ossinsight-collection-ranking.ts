/**
 * @fileoverview extract verticals ossinsight-collection-ranking module.
 */
import { capability, type VerticalExtractor } from "../capabilities.js";

const metrics = ["stars", "pull-requests", "issues"] as const;
const periods = ["past_24_hours", "past_28_days", "past_month"] as const;

type OssInsightMetric = (typeof metrics)[number];
type OssInsightPeriod = (typeof periods)[number];
type MetricValue = string | number;

interface OssInsightCollectionRow {
	id: string | number;
	name: string;
}

interface OssInsightRankingRow {
	repo_name?: string;
	stars?: MetricValue;
	forks?: MetricValue;
	pull_requests?: MetricValue;
	issues?: MetricValue;
	total_score?: MetricValue;
}

interface OssInsightRows<T> {
	data?: { rows?: T[]; result?: T[] };
}

export interface OssInsightCollectionRankingOutput {
	collection: { id: string | number; name: string; slug: string };
	metric: OssInsightMetric;
	period: OssInsightPeriod;
	rows: OssInsightRankingRow[];
}

export const ossInsightCollectionRankingExtractor: VerticalExtractor<OssInsightCollectionRankingOutput> = {
	capability: capability(
		"ossinsight_collection_ranking",
		["https://ossinsight.io/collections/:slug"],
		{
			type: "object",
			required: ["collection", "metric", "period", "rows"],
			properties: {
				collection: { type: "object" },
				metric: { enum: metrics },
				period: { enum: periods },
				rows: { type: "array" },
			},
		},
		{ requiresBrowser: false, requiresLLM: false, requiresCloud: false },
	),
	match: (url) => {
		if (url.hostname !== "ossinsight.io") return undefined;
		const parts = url.pathname.split("/").filter(Boolean);
		const metric = url.searchParams.get("metric") ?? "stars";
		const period = url.searchParams.get("period") ?? "past_28_days";
		if (parts.length !== 2 || parts[0] !== "collections") return undefined;
		if (!isMetric(metric) || !isPeriod(period)) return undefined;
		return { slug: parts[1] ?? "", metric, period };
	},
	extract: async (_url, match, context, signal) => {
		const metric = isMetric(match.metric) ? match.metric : "stars";
		const period = isPeriod(match.period) ? match.period : "past_28_days";
		const collections = await loadCollections(context, signal);
		const collection = collections.find((item) =>
			collectionSlugVariants(item).includes(match.slug),
		);
		if (!collection) throw new Error(`Unknown OSSInsight collection slug: ${match.slug}`);
		const payload = await context.fetchJson<OssInsightRows<OssInsightRankingRow>>(
			`https://api.ossinsight.io/v1/collections/${encodeURIComponent(String(collection.id))}/${rankingPath(metric)}/?period=${encodeURIComponent(period)}`,
			signal,
		);
		return {
			collection: { id: collection.id, name: collection.name, slug: match.slug },
			metric,
			period,
			rows: rowsOf(payload).map(trimRankingRow),
		};
	},
};

async function loadCollections(
	context: Parameters<VerticalExtractor["extract"]>[2],
	signal?: AbortSignal,
): Promise<OssInsightCollectionRow[]> {
	const payload = await context.fetchJson<OssInsightRows<OssInsightCollectionRow>>(
		"https://api.ossinsight.io/v1/collections/",
		signal,
	);
	return rowsOf(payload);
}

function rankingPath(metric: OssInsightMetric): string {
	return metric === "pull-requests" ? "ranking_by_prs" : `ranking_by_${metric}`;
}

function collectionSlugVariants(collection: OssInsightCollectionRow): string[] {
	const lower = collection.name.toLowerCase().trim();
	const variants = new Set<string>([
		String(collection.id),
		lower.replace(/&/gu, "").replace(/[^a-z0-9]/gu, "-").replace(/^-+|-+$/gu, ""),
		lower.replace(/[^a-z0-9]/gu, "-").replace(/^-+|-+$/gu, ""),
		lower.replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, ""),
	]);
	return [...variants].filter(Boolean);
}

function trimRankingRow(row: OssInsightRankingRow): OssInsightRankingRow {
	return {
		repo_name: row.repo_name,
		...(row.stars !== undefined ? { stars: row.stars } : {}),
		...(row.forks !== undefined ? { forks: row.forks } : {}),
		...(row.pull_requests !== undefined
			? { pull_requests: row.pull_requests }
			: {}),
		...(row.issues !== undefined ? { issues: row.issues } : {}),
		...(row.total_score !== undefined ? { total_score: row.total_score } : {}),
	};
}

function rowsOf<T>(payload: OssInsightRows<T> | T[]): T[] {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload.data?.rows)) return payload.data.rows;
	if (Array.isArray(payload.data?.result)) return payload.data.result;
	return [];
}

function isMetric(value: string): value is OssInsightMetric {
	return metrics.includes(value as OssInsightMetric);
}

function isPeriod(value: string): value is OssInsightPeriod {
	return periods.includes(value as OssInsightPeriod);
}
