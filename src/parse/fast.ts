import { type DataIslandContent, recoverDataIslands } from "./data-islands.js";
import { type DomAdapter, type DomSelection, loadDom } from "./dom-adapter.js";
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
	return extractFastPageFromDom(loadDom(html), url, options);
}

export function extractFastPageFromDom(
	dom: DomAdapter,
	url: string,
	options: FastExtractOptions = {},
): FastPageExtraction {
	const dataIslands = recoverDataIslands(dom);
	prepareDocument(dom, options);
	const metadata = extractMetadata(dom, url);
	const mainCandidates =
		options.onlyMainContent || options.includeMainCandidates
			? rankMainCandidates(dom)
			: [];
	const root = options.onlyMainContent
		? mainContentRoot(dom, mainCandidates)
		: selectedRoots(dom, options);
	return buildExtraction(dom, root, url, metadata, dataIslands, mainCandidates);
}

function buildExtraction(
	dom: DomAdapter,
	root: DomSelection,
	url: string,
	metadata: PageMetadata,
	dataIslands: DataIslandContent[],
	mainCandidates: MainContentCandidate[],
): FastPageExtraction {
	const text = visibleText(dom, root);
	const recovered =
		text.length < 1000 ? recoverUsefulContent(dom, url) : [];
	return {
		url,
		title: metadata.title,
		description: metadata.description,
		metadata,
		headings: extractHeadings(dom),
		links: extractLinks(dom, url),
		text,
		html: outerHtml(dom, root),
		dataIslands,
		recovered,
		mainCandidates,
	};
}
