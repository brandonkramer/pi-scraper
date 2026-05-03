import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import { type DataIslandContent, recoverDataIslands } from "./data-islands.js";
import {
	extractHeadings,
	extractLinks,
	extractMetadata,
	type PageHeading,
	type PageLink,
	type PageMetadata,
} from "./metadata.js";
import {
	type MainContentCandidate,
	mainContentRoot,
	rankMainCandidates,
} from "./noise.js";
import { type RecoveredContent, recoverUsefulContent } from "./recovery.js";
import {
	outerHtml,
	prepareDocument,
	type SelectorOptions,
	selectedRoots,
	visibleText,
} from "./selectors.js";

export interface FastExtractOptions extends SelectorOptions {
	onlyMainContent?: boolean;
	includeMainCandidates?: boolean;
}

export interface FastPageExtraction {
	url: string;
	title?: string;
	description?: string;
	metadata: PageMetadata;
	headings: PageHeading[];
	links: PageLink[];
	text: string;
	html: string;
	dataIslands: DataIslandContent[];
	recovered: RecoveredContent[];
	mainCandidates: MainContentCandidate[];
}

export function extractFastPage(
	html: string,
	url: string,
	options: FastExtractOptions = {},
): FastPageExtraction {
	const $ = cheerio.load(html);
	const dataIslands = recoverDataIslands($);
	prepareDocument($, options);
	const metadata = extractMetadata($, url);
	const mainCandidates =
		options.onlyMainContent || options.includeMainCandidates
			? rankMainCandidates($)
			: [];
	const root = options.onlyMainContent
		? mainContentRoot($, mainCandidates)
		: selectedRoots($, options);
	return buildExtraction($, root, url, metadata, dataIslands, mainCandidates);
}

function buildExtraction(
	$: CheerioAPI,
	root: ReturnType<typeof selectedRoots>,
	url: string,
	metadata: PageMetadata,
	dataIslands: DataIslandContent[],
	mainCandidates: MainContentCandidate[],
): FastPageExtraction {
	return {
		url,
		title: metadata.title,
		description: metadata.description,
		metadata,
		headings: extractHeadings($),
		links: extractLinks($, url),
		text: visibleText($, root),
		html: outerHtml($, root),
		dataIslands,
		recovered: recoverUsefulContent($, url),
		mainCandidates,
	};
}
