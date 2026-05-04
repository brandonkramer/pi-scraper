import { type Static, Type } from "@mariozechner/pi-ai";
import { listFetches } from "../storage/cache.js";
import { listStoredResponses } from "../storage/results.js";
import { defineWebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { urlProperty } from "./schemas.js";

export const webHistorySchema = Type.Object({
	url: urlProperty("URL whose prior local scrapes/fetches should be listed."),
	since: Type.Optional(Type.String({ description: "Relative duration like 1h, 24h, 7d, or ISO 8601 timestamp." })),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
});

type Params = Static<typeof webHistorySchema>;

export const webHistoryTool = defineWebTool({
	name: "web_history",
	label: "Web History",
	description: "List prior local scrapes and raw fetches for a URL from the SQLite scraper index.",
	parameters: webHistorySchema,
	async execute(_toolCallId, params: Params) {
		const since = parseSince(params.since);
		const limit = params.limit ?? 10;
		const [responses, fetches] = await Promise.all([
			listStoredResponses(params.url, { since, limit }),
			listFetches(params.url, { since, limit }),
		]);
		const entries = [...responses.map((row) => ({ kind: "response", ...row })), ...fetches.map((row) => ({ kind: "fetch", ...row }))]
			.sort((left, right) => timestamp(right).localeCompare(timestamp(left)))
			.slice(0, limit);
		return toolResult({
			text: entries.length ? `${entries.length} prior scrape/fetch record(s) for ${params.url}` : `No prior scrapes for ${params.url}`,
			data: { url: params.url, entries },
			url: params.url,
			format: "json",
			contentType: "application/json",
		});
	},
	renderCall: (args, theme) => renderSimpleCall("web_history", [args.url], theme),
	renderResult: (result, { expanded }) => renderEnvelopeResult(result, expanded),
});

function parseSince(value: string | undefined): Date | undefined {
	if (!value) return undefined;
	const relative = /^(\d+)([hHdD])$/u.exec(value.trim());
	if (relative) {
		const amount = Number.parseInt(relative[1]!, 10);
		const unit = relative[2]!.toLowerCase();
		return new Date(Date.now() - amount * (unit === "h" ? 3_600_000 : 86_400_000));
	}
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function timestamp(row: Record<string, unknown>): string {
	return String(row.storedAt ?? row.fetchedAt ?? "");
}
