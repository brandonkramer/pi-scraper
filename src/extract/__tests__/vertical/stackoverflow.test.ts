/** @file Stack Overflow vertical extractor tests. */
import { describe, expect, it, vi } from "vitest";

import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import {
	buildManifestRegistry,
	clearManifestRegistryCache,
} from "../../vertical/manifest-registry.ts";
import { runVerticalExtractor } from "../../vertical/registry.ts";

const signal = new AbortController().signal;

function questionResponse() {
	return {
		items: [
			{
				question_id: 11227809,
				title: "Why is conditional processing faster?",
				body: "<p>Branch prediction example</p>",
				tags: ["java", "performance"],
				score: 27535,
				view_count: 1986373,
				answer_count: 26,
				is_answered: true,
				accepted_answer_id: 11227902,
				link: "https://stackoverflow.com/questions/11227809/why-is-conditional-processing-faster",
				creation_date: 1340805096,
				last_activity_date: 1775626532,
				owner: {
					display_name: "GManNickG",
					reputation: 507059,
					link: "https://stackoverflow.com/users/87234/gmannickg",
					user_id: 87234,
				},
			},
		],
	};
}

function answersResponse() {
	return {
		items: [
			{
				answer_id: 11227902,
				body: "<p>Because branch prediction</p>",
				score: 40000,
				is_accepted: true,
				creation_date: 1340806000,
				last_activity_date: 1340807000,
				owner: { display_name: "Mystical" },
			},
			{
				answer_id: 11227903,
				body: "<p>Another answer</p>",
				score: 100,
				is_accepted: false,
				creation_date: 1340806100,
				last_activity_date: 1340807100,
				owner: { display_name: "Dev" },
			},
		],
	};
}

function commentsResponse() {
	return {
		items: [
			{
				comment_id: 1,
				body: "Great question",
				score: 42,
				creation_date: 1340806200,
				owner: { display_name: "Reader" },
			},
		],
	};
}

function stackOverflowContext(key?: string): VerticalExtractorContext {
	const baseFetch = vi.fn(async (url: string) => {
		const parsed = new URL(url);
		expect(parsed.searchParams.get("site")).toBe("stackoverflow");
		expect(parsed.searchParams.get("filter")).toBe("withbody");

		if (url.includes("/questions/11227809/answers")) {
			return answersResponse();
		}
		if (url.includes("/questions/11227809/comments")) {
			return commentsResponse();
		}
		if (url.includes("/questions/11227809")) {
			return questionResponse();
		}
		throw new Error(`Unexpected URL: ${url}`);
	}) as VerticalExtractorContext["fetchJson"];

	if (key) {
		const fetchJson = vi.fn(async (url: string) => {
			const parsed = new URL(url);
			// eslint-disable-next-line vitest/no-conditional-expect -- wrapping fn only created when key is set; expect fires unconditionally on every call
			expect(parsed.searchParams.get("key")).toBe(key);
			return await baseFetch(url);
		}) as VerticalExtractorContext["fetchJson"];
		return { fetchJson };
	}

	return { fetchJson: baseFetch };
}

describe("stackoverflow vertical extractor", () => {
	it("matches stackoverflow.com question URLs", async () => {
		clearManifestRegistryCache();
		const registry = await buildManifestRegistry(false);
		const withSlug = registry.match(
			new URL("https://stackoverflow.com/questions/11227809/why-is-conditional-processing-faster"),
		);
		expect(withSlug?.entry.manifest.name).toBe("stackoverflow");
		expect(withSlug?.captures).toEqual({
			id: "11227809",
			slug: "why-is-conditional-processing-faster",
		});

		const idOnly = registry.match(new URL("https://stackoverflow.com/questions/11227809"));
		expect(idOnly?.entry.manifest.name).toBe("stackoverflow");
		expect(idOnly?.captures).toEqual({ id: "11227809" });
	});

	it("extracts question metadata, answers, and comments", async () => {
		const result = await runVerticalExtractor(
			"stackoverflow",
			"https://stackoverflow.com/questions/11227809/why-is-conditional-processing-faster",
			{ context: stackOverflowContext() },
			signal,
		);

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			id: 11227809,
			slug: "why-is-conditional-processing-faster",
			title: "Why is conditional processing faster?",
			body: "<p>Branch prediction example</p>",
			tags: ["java", "performance"],
			score: 27535,
			viewCount: 1986373,
			answerCount: 26,
			isAnswered: true,
			acceptedAnswerId: 11227902,
			link: "https://stackoverflow.com/questions/11227809/why-is-conditional-processing-faster",
			owner: {
				displayName: "GManNickG",
				reputation: 507059,
				profileUrl: "https://stackoverflow.com/users/87234/gmannickg",
				userId: 87234,
			},
			answers: [
				{
					id: 11227902,
					body: "<p>Because branch prediction</p>",
					score: 40000,
					isAccepted: true,
					owner: "Mystical",
				},
				{
					id: 11227903,
					body: "<p>Another answer</p>",
					score: 100,
					isAccepted: false,
					owner: "Dev",
				},
			],
			comments: [
				{
					id: 1,
					body: "Great question",
					score: 42,
					owner: "Reader",
				},
			],
		});
	});

	it("forwards the Stack Exchange API key query param when provided", async () => {
		const result = await runVerticalExtractor(
			"stackoverflow",
			"https://stackoverflow.com/questions/11227809/example?key=sekret",
			{ context: stackOverflowContext("sekret") },
			signal,
		);
		expect(result.error).toBeUndefined();
		expect(result.data).toBeDefined();
	});
});
