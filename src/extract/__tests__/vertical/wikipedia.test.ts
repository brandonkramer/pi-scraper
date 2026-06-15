/** @file Wikipedia vertical extractor tests. */
import { describe, expect, it, vi } from "vitest";

import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import {
	buildManifestRegistry,
	clearManifestRegistryCache,
} from "../../vertical/manifest-registry.ts";
import { runVerticalExtractor } from "../../vertical/registry.ts";

const signal = new AbortController().signal;

function summaryResponse(lang: string) {
	return {
		type: "standard",
		title: lang === "de" ? "Python (Programmiersprache)" : "Python (programming language)",
		lang,
		description: lang === "de" ? "Programmiersprache" : "General-purpose programming language",
		extract:
			lang === "de"
				? "Python ist eine universell nutzbare Programmiersprache."
				: "Python is a high-level, general-purpose programming language.",
		revision: "1358757939",
		timestamp: "2026-06-10T19:22:48Z",
		wikibase_item: "Q28865",
		thumbnail: {
			source:
				"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Python-logo-notext.svg/330px-Python-logo-notext.svg.png",
		},
		content_urls: {
			desktop: {
				page:
					lang === "de"
						? "https://de.wikipedia.org/wiki/Python_(Programmiersprache)"
						: "https://en.wikipedia.org/wiki/Python_(programming_language)",
			},
		},
	};
}

function sectionsResponse() {
	return {
		parse: {
			title: "Python (programming language)",
			sections: [
				{
					toclevel: 1,
					level: "2",
					line: "History",
					number: "1",
					anchor: "History",
				},
				{
					toclevel: 1,
					level: "2",
					line: "Design philosophy and features",
					number: "2",
					anchor: "Design_philosophy_and_features",
				},
			],
		},
	};
}

function imagesResponse() {
	return {
		files: [
			{
				title: "Python-logo-notext.svg",
				preferred: {
					url: "//upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Python-logo-notext.svg/330px-Python-logo-notext.svg.png",
					width: 330,
					height: 330,
				},
				original: {
					url: "//upload.wikimedia.org/wikipedia/commons/c/c3/Python-logo-notext.svg",
				},
			},
		],
	};
}

function referencesResponse() {
	return {
		parse: {
			externallinks: [
				"https://docs.python.org/3/faq/general.html#what-is-python",
				"https://www.python.org/",
			],
		},
	};
}

function wikipediaContext(): VerticalExtractorContext {
	const fetchJson = vi.fn(async (url: string) => {
		const parsed = new URL(url);
		expect(parsed.hostname.endsWith(".wikipedia.org")).toBe(true);
		const lang = parsed.hostname.split(".")[0];

		if (url.includes("/api/rest_v1/page/summary/")) {
			return summaryResponse(lang);
		}
		if (url.includes("action=parse") && url.includes("prop=sections")) {
			return sectionsResponse();
		}
		if (url.includes("/links/media")) {
			return imagesResponse();
		}
		if (url.includes("action=parse") && url.includes("prop=externallinks")) {
			return referencesResponse();
		}
		throw new Error(`Unexpected URL: ${url}`);
	}) as VerticalExtractorContext["fetchJson"];
	return { fetchJson };
}

describe("wikipedia vertical extractor", () => {
	it("matches English and localized Wikipedia article URLs", async () => {
		clearManifestRegistryCache();
		const registry = await buildManifestRegistry(false);

		const english = registry.match(
			new URL("https://en.wikipedia.org/wiki/Python_(programming_language)"),
		);
		expect(english?.entry.manifest.name).toBe("wikipedia");
		expect(english?.captures).toEqual({
			lang: "en",
			title: "Python_(programming_language)",
		});

		const german = registry.match(
			new URL("https://de.wikipedia.org/wiki/Python_(Programmiersprache)"),
		);
		expect(german?.entry.manifest.name).toBe("wikipedia");
		expect(german?.captures).toEqual({
			lang: "de",
			title: "Python_(Programmiersprache)",
		});
	});

	it("extracts article metadata, sections, images, and references", async () => {
		const result = await runVerticalExtractor(
			"wikipedia",
			"https://en.wikipedia.org/wiki/Python_(programming_language)",
			{ context: wikipediaContext() },
			signal,
		);

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			lang: "en",
			title: "Python (programming language)",
			description: "General-purpose programming language",
			extract: "Python is a high-level, general-purpose programming language.",
			pageUrl: "https://en.wikipedia.org/wiki/Python_(programming_language)",
			revision: "1358757939",
			timestamp: "2026-06-10T19:22:48Z",
			wikibaseItem: "Q28865",
			sections: [
				{ level: "2", line: "History", number: "1", anchor: "History" },
				{
					level: "2",
					line: "Design philosophy and features",
					number: "2",
					anchor: "Design_philosophy_and_features",
				},
			],
			images: [
				{
					title: "Python-logo-notext.svg",
					url: "//upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Python-logo-notext.svg/330px-Python-logo-notext.svg.png",
					width: 330,
					height: 330,
					originalUrl: "//upload.wikimedia.org/wikipedia/commons/c/c3/Python-logo-notext.svg",
				},
			],
			references: [
				"https://docs.python.org/3/faq/general.html#what-is-python",
				"https://www.python.org/",
			],
		});
	});

	it("uses the captured language subdomain for non-English articles", async () => {
		const attempted: string[] = [];
		const fetchJson = (async (url: string) => {
			attempted.push(url);
			const parsed = new URL(url);
			expect(parsed.hostname.endsWith(".wikipedia.org")).toBe(true);
			const lang = parsed.hostname.split(".")[0];

			if (url.includes("/api/rest_v1/page/summary/")) {
				return summaryResponse(lang);
			}
			if (url.includes("action=parse") && url.includes("prop=sections")) {
				return sectionsResponse();
			}
			if (url.includes("/links/media")) {
				return imagesResponse();
			}
			if (url.includes("action=parse") && url.includes("prop=externallinks")) {
				return referencesResponse();
			}
			throw new Error(`Unexpected URL: ${url}`);
		}) as VerticalExtractorContext["fetchJson"];
		const result = await runVerticalExtractor(
			"wikipedia",
			"https://de.wikipedia.org/wiki/Python_(Programmiersprache)",
			{ context: { fetchJson } },
			signal,
		);

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			lang: "de",
			title: "Python (Programmiersprache)",
			extract: "Python ist eine universell nutzbare Programmiersprache.",
		});
		expect(attempted.length).toBeGreaterThan(0);
		for (const url of attempted) {
			expect(url).toMatch(/^https:\/\/de\.wikipedia\.org\//);
		}
	});
});
