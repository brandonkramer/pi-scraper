/**
 * @fileoverview extract verticals ossinsight-trending-repos module.
 */
import { capability, type VerticalExtractor } from "../capabilities.js";
import { rowsOf, type OssInsightRows } from "./ossinsight-shared.js";

const periods = ["past_24_hours", "past_week", "past_month"] as const;
type OssInsightTrendingPeriod = (typeof periods)[number];
type MetricValue = string | number;

interface OssInsightTrendingRepoRow {
	repo_name?: string;
	stars?: MetricValue;
	forks?: MetricValue;
	pull_requests?: MetricValue;
	pushes?: MetricValue;
	total_score?: MetricValue;
	primary_language?: string;
	description?: string;
}

export interface OssInsightTrendingReposOutput {
	period: OssInsightTrendingPeriod;
	language: string;
	rows: OssInsightTrendingRepoRow[];
}

export const ossInsightTrendingReposExtractor: VerticalExtractor<OssInsightTrendingReposOutput> =
	{
		capability: capability("ossinsight_trending_repos", [
				"https://ossinsight.io/trending",
				"https://ossinsight.io/trending/:language",
			], {
				type: "object",
				required: ["period", "language", "rows"],
				properties: {
					period: { enum: periods },
					language: { type: "string" },
					rows: { type: "array" },
				},
			}),
		match: (url) => {
			if (url.hostname !== "ossinsight.io") return undefined;
			const parts = url.pathname.split("/").filter(Boolean);
			const period = url.searchParams.get("period") ?? "past_24_hours";
			if (!isPeriod(period)) return undefined;
			if (parts.length === 1 && parts[0] === "trending") {
				return { language: "All", period };
			}
			return parts.length === 2 && parts[0] === "trending"
				? { language: decodeURIComponent(parts[1] ?? "All"), period }
				: undefined;
		},
		extract: async (_url, match, context, signal) => {
			const period = isPeriod(match.period) ? match.period : "past_24_hours";
			const language = match.language || "All";
			const payload = await context.fetchJson<
				OssInsightRows<OssInsightTrendingRepoRow>
			>(
				`https://api.ossinsight.io/v1/trends/repos/?period=${encodeURIComponent(period)}&language=${encodeURIComponent(language)}`,
				signal,
			);
			return { period, language, rows: rowsOf(payload).map(trimTrendingRow) };
		},
	};

function trimTrendingRow(
	row: OssInsightTrendingRepoRow,
): OssInsightTrendingRepoRow {
	return {
		repo_name: row.repo_name,
		...(row.stars !== undefined ? { stars: row.stars } : {}),
		...(row.forks !== undefined ? { forks: row.forks } : {}),
		...(row.pull_requests !== undefined
			? { pull_requests: row.pull_requests }
			: {}),
		...(row.pushes !== undefined ? { pushes: row.pushes } : {}),
		...(row.total_score !== undefined ? { total_score: row.total_score } : {}),
		...(row.primary_language !== undefined
			? { primary_language: row.primary_language }
			: {}),
		...(row.description !== undefined ? { description: row.description } : {}),
	};
}

function isPeriod(value: string): value is OssInsightTrendingPeriod {
	return periods.includes(value as OssInsightTrendingPeriod);
}
