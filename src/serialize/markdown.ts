import TurndownService from "turndown";
import turndownPluginGfm from "turndown-plugin-gfm";
import { normalizeWhitespace } from "./text.js";

export interface MarkdownOptions {
	removeImages?: boolean;
}

/**
 * Converts cleaned HTML to stable Markdown for model-facing output.
 *
 * @remarks
 * Turndown service construction registers rule objects and plugins. Keeping one
 * configured service per image policy avoids repeated setup in hot scrape paths
 * while preserving deterministic output rules.
 */
export function htmlToMarkdown(
	html: string,
	options: MarkdownOptions = {},
): string {
	const service =
		options.removeImages === false ? keepImagesService : removeImagesService;
	return normalizeWhitespace(service.turndown(stripLargeElements(html)));
}

/** Strip large tables and very long lists before Turndown to avoid expensive conversion
 *  on element-heavy pages where the output is likely to be truncated anyway.
 *  Only applies when HTML exceeds 40 KB. Tables: > 20 rows. Lists: > 100 items. */
function stripLargeElements(html: string): string {
	if (html.length < 40_000) return html;
	// Count table rows and list items
	const trCount = (html.match(/<tr/gi) ?? []).length;
	const liCount = (html.match(/<li/gi) ?? []).length;
	if (trCount < 20 && liCount < 100) return html;
	// Strip tables and/or lists if thresholds exceeded
	let result = html;
	if (trCount >= 20) {
		result = result.replace(/<table[\s\S]*?<\/table>/gi, "\n\n");
	}
	if (liCount >= 100) {
		result = result.replace(
			/<(ul|ol)[\s\S]*?<\/(ul|ol)>/gi,
			"\n\n[Long list]\n\n",
		);
	}
	return result;
}

function createMarkdownService(removeImages: boolean): TurndownService {
	const turndown = new TurndownService({
		codeBlockStyle: "fenced",
		headingStyle: "atx",
		bulletListMarker: "-",
		emDelimiter: "_",
		strongDelimiter: "**",
	});
	turndown.use(turndownPluginGfm.gfm);
	turndown.remove(["script", "style", "noscript", "template"]);
	if (removeImages) {
		turndown.addRule("removeImages", { filter: "img", replacement: () => "" });
	}
	turndown.addRule("stableLinks", {
		filter: "a",
		replacement: (content, node) => {
			const href = (node as HTMLElement).getAttribute("href");
			const label = normalizeWhitespace(content);
			if (!href) return label;
			return label ? `[${label}](${href})` : href;
		},
	});
	return turndown;
}

const removeImagesService = createMarkdownService(true);
const keepImagesService = createMarkdownService(false);
