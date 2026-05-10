/**
 * @fileoverview extract verticals hackernews module.
 */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

interface HackerNewsItem {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  by?: string;
  score?: number;
  descendants?: number;
  time?: number;
  text?: string;
}

export const hackerNewsItemExtractor: VerticalExtractor = {
  capability: capability("hackernews", ["https://news.ycombinator.com/item?id=:id"], {
    type: "object",
    required: ["id"],
    properties: { id: { type: "number" }, title: { type: "string" }, url: { type: "string" } },
  }),
  match: (url) => {
    if (url.hostname !== "news.ycombinator.com") return undefined;
    const id = url.searchParams.get("id");
    return id ? { id } : undefined;
  },
  extract: async (_url, match, context, signal) => {
    const item = await context.fetchJson<HackerNewsItem>(`https://hacker-news.firebaseio.com/v0/item/${match.id}.json`, signal);
    return { id: item.id, type: item.type, title: item.title, url: item.url, by: item.by, score: item.score, comments: item.descendants, time: item.time, text: item.text };
  },
};
