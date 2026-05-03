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
	return normalizeWhitespace(service.turndown(html));
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
