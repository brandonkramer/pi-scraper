/**
 * @fileoverview extract verticals ossinsight-repo-analytics module.
 */
import { capability, type VerticalExtractor } from "../capabilities.js";

type MetricValue = string | number;

interface OssInsightStargazerRow {
	date?: string;
	event_month?: string;
	stars?: MetricValue;
	stargazers?: MetricValue;
	total?: MetricValue;
}

interface OssInsightRows<T> {
	data?: { rows?: T[]; result?: T[] };
}

export interface OssInsightRepoAnalyticsOutput {
	owner: string;
	repo: string;
	stargazers: Array<{ event_month?: string; stars?: number; total?: number }>;
}

export const ossInsightRepoAnalyticsExtractor: VerticalExtractor<OssInsightRepoAnalyticsOutput> = {
	capability: capability(
		"ossinsight_repo_analytics",
		["https://ossinsight.io/analyze/:owner/:repo"],
		{
			type: "object",
			required: ["owner", "repo", "stargazers"],
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				stargazers: { type: "array" },
			},
		},
		{ requiresBrowser: false, requiresLLM: false, requiresCloud: false },
	),
	match: (url) => {
		if (url.hostname !== "ossinsight.io") return undefined;
		const parts = url.pathname.split("/").filter(Boolean);
		return parts.length === 3 && parts[0] === "analyze"
			? { owner: parts[1] ?? "", repo: parts[2] ?? "" }
			: undefined;
	},
	extract: async (_url, match, context, signal) => {
		const owner = match.owner;
		const repo = match.repo;
		const payload = await context.fetchJson<OssInsightRows<OssInsightStargazerRow>>(
			`https://api.ossinsight.io/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stargazers/history/?per=month&from=2010-01-01&to=2099-01-01`,
			signal,
		);
		return {
			owner,
			repo,
			stargazers: rowsOf(payload).map((row) => ({
				event_month: row.event_month ?? row.date,
				...(toNumber(row.stars) !== undefined
					? { stars: toNumber(row.stars) }
					: {}),
				...(toNumber(row.total ?? row.stargazers) !== undefined
					? { total: toNumber(row.total ?? row.stargazers) }
					: {}),
			})),
		};
	},
};

function rowsOf<T>(payload: OssInsightRows<T> | T[]): T[] {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload.data?.rows)) return payload.data.rows;
	if (Array.isArray(payload.data?.result)) return payload.data.result;
	return [];
}

function toNumber(value: MetricValue | undefined): number | undefined {
	if (value === undefined) return undefined;
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : undefined;
}
