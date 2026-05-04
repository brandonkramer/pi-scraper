import { type Static, Type } from "@mariozechner/pi-ai";
import { listFetches } from "../storage/cache.js";
import { listStoredResponses } from "../storage/results.js";
import type { AgenticNextAction, AgenticQualitySignals } from "../types.js";
import {
	ageSecondsSince,
	formatAge,
	qualityFromStaleness,
	refreshUrlAction,
	retrieveResultAction,
	sourceNote,
	storedResultGuidance,
} from "./agentic-context.js";
import { defineWebTool } from "./define.js";
import { renderWebHistoryResult, renderWebToolCall } from "./web-renderers.js";
import { toolResult } from "./result.js";
import { urlProperty } from "./schemas.js";

export const webHistorySchema = Type.Object({
	url: urlProperty("URL whose prior local scrapes/fetches should be listed."),
	since: Type.Optional(
		Type.String({
			description: "Relative duration like 1h, 24h, 7d, or ISO 8601 timestamp.",
		}),
	),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
});

type Params = Static<typeof webHistorySchema>;

type HistoryEntry = Record<string, unknown> & { kind: "response" | "fetch" };

export const webHistoryTool = defineWebTool({
	name: "web_history",
	label: "Web History",
	description:
		"List prior local scrapes and raw fetches for a URL from the SQLite scraper index.",
	parameters: webHistorySchema,
	async execute(_toolCallId, params: Params) {
		const since = parseSince(params.since);
		const limit = params.limit ?? 10;
		const [responses, fetches] = await Promise.all([
			listStoredResponses(params.url, { since, limit }),
			listFetches(params.url, { since, limit }),
		]);
		const entries = [
			...responses.map((row) => ({ kind: "response" as const, ...row })),
			...fetches.map((row) => ({ kind: "fetch" as const, ...row })),
		]
			.sort((left, right) => timestamp(right).localeCompare(timestamp(left)))
			.slice(0, limit);
		const shaped = shapeHistory(params.url, entries, limit);
		return toolResult({
			text: shaped.text,
			data: { url: params.url, entries },
			url: params.url,
			format: "json",
			contentType: "application/json",
			...shaped.context,
		});
	},
	renderCall: (args, theme, context) =>
		renderWebToolCall("web_history", [args.url], theme, context, {
			animate: false,
		}),
	renderResult: (result, { expanded }) =>
		renderWebHistoryResult(result, expanded),
});

function shapeHistory(url: string, entries: HistoryEntry[], limit: number) {
	const latest = entries[0];
	const latestResponse = entries.find((entry) => stringField(entry.responseId));
	const actions: AgenticNextAction[] = [refreshUrlAction(url)];
	if (latestResponse) {
		actions.unshift(
			retrieveResultAction(
				String(latestResponse.responseId),
				"Read the latest stored scrape instead of refetching.",
			),
		);
	}
	if (!latest) {
		return {
			text: `No prior scrapes for ${url}; fetch the page before reusing stored content.`,
			context: {
				summary: `No prior scrapes for ${url}.`,
				answerContext: `No local scrape or fetch records were found for ${url}. A fresh web_scrape call is needed before answering from stored evidence.`,
				qualitySignals: {
					confidence: "high",
					freshness: "unknown",
					coverage: "complete",
				} satisfies AgenticQualitySignals,
				nextActions: actions,
				assistantGuidance: storedResultGuidance(),
			},
		};
	}
	const latestAge = formatAge(ageSecondsSince(timestamp(latest)));
	const responseId = latestResponse
		? String(latestResponse.responseId)
		: undefined;
	const staleness = stalenessFromEntry(latest);
	const text = responseId
		? `Found ${entries.length} prior record(s) for ${url}. Latest stored scrape ${shortId(responseId)} was stored ${latestAge}.`
		: `Found ${entries.length} prior record(s) for ${url}. Latest record is a raw fetch from ${latestAge}; scrape again to create a retrievable result.`;
	return {
		text,
		context: {
			summary: text,
			answerContext: historyAnswerContext(url, entries, responseId),
			sourceNotes: entries.slice(0, 3).map((entry, index) =>
				sourceNote({
					id: `h${index + 1}`,
					uri: url,
					excerpt: `${entry.kind} · status ${String(entry.status ?? "unknown")} · ${formatAge(ageSecondsSince(timestamp(entry)))}`,
					relevance:
						entry.kind === "response"
							? "Stored scrape can be retrieved with responseId."
							: "Raw fetch record proves the URL was fetched locally.",
					retrievedAt: timestamp(entry),
					sourceType: "database",
				}),
			),
			qualitySignals: qualityFromStaleness(
				staleness,
				entries.length >= limit ? "top_n_only" : "complete",
			),
			nextActions: actions,
			assistantGuidance: storedResultGuidance(),
		},
	};
}

function historyAnswerContext(
	url: string,
	entries: HistoryEntry[],
	responseId: string | undefined,
): string {
	const lines = entries.slice(0, 5).map((entry) => {
		const id = stringField(entry.responseId);
		return `- ${entry.kind} ${id ? `responseId ${id}` : "without responseId"}: status ${String(entry.status ?? "unknown")}, ${formatAge(ageSecondsSince(timestamp(entry)))}, type ${String(entry.contentType ?? "unknown")}`;
	});
	const reuse = responseId
		? `Use web_get_result with responseId ${responseId} when the stored age is acceptable.`
		: "No retrievable scrape result was found; use web_scrape to create one.";
	return [
		`Local history for ${url}:`,
		...lines,
		reuse,
		"Refresh for time-sensitive facts.",
	].join("\n");
}

function stalenessFromEntry(entry: HistoryEntry): string | undefined {
	const expiresAt = stringField(entry.expiresAt);
	if (!expiresAt) return undefined;
	return Date.parse(expiresAt) < Date.now() ? "stale" : "fresh";
}

function parseSince(value: string | undefined): Date | undefined {
	if (!value) return undefined;
	const relative = /^(\d+)([hHdD])$/u.exec(value.trim());
	if (relative) {
		const amount = Number.parseInt(relative[1]!, 10);
		const unit = relative[2]!.toLowerCase();
		return new Date(
			Date.now() - amount * (unit === "h" ? 3_600_000 : 86_400_000),
		);
	}
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function timestamp(row: Record<string, unknown>): string {
	return String(row.storedAt ?? row.fetchedAt ?? "");
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function shortId(responseId: string): string {
	return `${responseId.slice(0, 8)}…`;
}
