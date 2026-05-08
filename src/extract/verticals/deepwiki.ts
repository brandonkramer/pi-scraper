/**
 * @fileoverview extract verticals deepwiki module.
 */
import { capability, type VerticalExtractor } from "../capabilities.js";

interface DeepWikiResult {
	owner: string;
	repo: string;
	lastIndexed?: string;
	commit?: string;
	sections: string[];
	activeSection?: string;
	sourceFiles: string[];
	githubUrl?: string;
}

export const deepWikiExtractor: VerticalExtractor = {
	capability: capability("deepwiki", ["https://deepwiki.com/:owner/:repo"], {
		type: "object",
		required: ["owner", "repo", "sections"],
		properties: {
			owner: { type: "string" },
			repo: { type: "string" },
			lastIndexed: { type: "string" },
			commit: { type: "string" },
			sections: { type: "array", items: { type: "string" } },
			activeSection: { type: "string" },
			sourceFiles: { type: "array", items: { type: "string" } },
			githubUrl: { type: "string" },
		},
	}),
	match: (url) => {
		if (url.hostname !== "deepwiki.com") return undefined;
		const [owner, repo] = url.pathname.split("/").filter(Boolean);
		return owner && repo ? { owner, repo } : undefined;
	},
	extract: async (_url, match, context, signal) => {
		if (!context.fetchText) {
			throw new Error("DeepWiki extractor requires fetchText support");
		}
		const text = await context.fetchText(
			`https://deepwiki.com/${match.owner}/${match.repo}`,
			signal,
		);
		return parseDeepWiki(text, match.owner, match.repo);
	},
};

function parseDeepWiki(
	text: string,
	owner: string,
	repo: string,
): DeepWikiResult {
	const cleanedText = cleanDeepWikiText(text);
	const lastIndexedMatch = cleanedText.match(
		/Last indexed:\s*([^()]+?)\s*\(\s*([a-f0-9]+)\s*\)/iu,
	);
	const lastIndexed = lastIndexedMatch?.[1]?.trim();
	const commit = lastIndexedMatch?.[2];

	return {
		owner,
		repo,
		lastIndexed,
		commit,
		sections: extractTextSections(cleanedText),
		activeSection: extractActiveSection(cleanedText),
		sourceFiles: extractSourceFiles(cleanedText),
		githubUrl: `https://github.com/${owner}/${repo}`,
	};
}

function cleanDeepWikiText(text: string): string {
	return text
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function extractSourceFiles(text: string): string[] {
	// DeepWiki's HTML collapses into a single text run after tag stripping. After
	// the marker, source paths appear contiguously until nav/footer text resumes.
	const marker = "Relevant source files";
	const startIdx = text.indexOf(marker);
	if (startIdx === -1) return [];

	const files: string[] = [];
	const tail = text.slice(startIdx + marker.length).trim();
	for (const token of tail.split(/\s+/u)) {
		const candidate = token.replace(/^[([{]+|[),.;:]+$/gu, "");
		if (!candidate) continue;
		if (!isSourcePathToken(candidate)) break;
		files.push(candidate);
	}
	return files;
}

function isSourcePathToken(token: string): boolean {
	return (
		token.includes("/") || /\.[A-Za-z0-9][A-Za-z0-9_-]*(?:$|[?#])/u.test(token)
	);
}

function extractTextSections(text: string): string[] {
	// DeepWiki navigation is exposed as flattened text after static HTML cleanup.
	// Parse the segment after the last-indexed marker and before the Glossary item.
	const startMatch = text.match(/Last indexed:[^)]*\)\s*/iu);
	if (!startMatch || startMatch.index === undefined) return [];
	const startIdx = startMatch.index + startMatch[0].length;

	const endIdx = text.indexOf("Glossary", startIdx);
	const segment =
		endIdx === -1 ? text.slice(startIdx) : text.slice(startIdx, endIdx);
	return uniqueSections(splitSectionSegment(segment));
}

function splitSectionSegment(segment: string): string[] {
	const words = segment
		.replace(/(?<=[a-z)])(?=[A-Z])/gu, " ")
		.split(/\s+/u)
		.map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9&/._-]+$/gu, ""))
		.filter(Boolean);
	const sections: string[] = [];
	let index = 0;
	while (index < words.length) {
		const known = matchKnownSection(words, index);
		if (known) {
			sections.push(known.label);
			index += known.words;
			continue;
		}
		sections.push(words[index] ?? "");
		index += 1;
	}
	return sections;
}

const knownSectionLabels = [
	"Repository Structure",
	"Development Workflow",
	"System Architecture",
	"Core Components",
	"API Reference",
	"Feature Flags",
	"Key Concepts",
	"Key Features",
	"Build System",
	"Data Flow",
	"Architecture",
	"Configuration",
	"Deployment",
	"Implementation",
	"Infrastructure",
	"Authentication",
	"Components",
	"Database",
	"Examples",
	"Frontend",
	"Backend",
	"Overview",
	"Packages",
	"Testing",
] as const;

function matchKnownSection(
	words: string[],
	start: number,
): { label: string; words: number } | undefined {
	for (const label of knownSectionLabels) {
		const labelWords = label.split(" ");
		const candidate = words.slice(start, start + labelWords.length);
		if (candidate.length !== labelWords.length) continue;
		if (candidate.join(" ").toLowerCase() === label.toLowerCase()) {
			return { label, words: labelWords.length };
		}
	}
	return undefined;
}

function uniqueSections(sections: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const section of sections) {
		const cleaned = cleanSectionName(section);
		if (!cleaned || isNoiseSection(cleaned) || seen.has(cleaned)) continue;
		seen.add(cleaned);
		result.push(cleaned);
	}
	return result;
}

function cleanSectionName(section: string): string {
	return section
		.replace(/^[^A-Za-z0-9]+/, "")
		.replace(/[^A-Za-z0-9&/._\s-]+$/u, "")
		.trim();
}

function isNoiseSection(section: string): boolean {
	return (
		section.length <= 2 ||
		section.startsWith("Menu") ||
		section.startsWith("Loading") ||
		section.startsWith("Devin") ||
		section.startsWith("Edit Wiki") ||
		section.startsWith("Share") ||
		section.startsWith("Index") ||
		section.startsWith("DeepWiki")
	);
}

function extractActiveSection(text: string): string | undefined {
	const match = text.match(
		/(?:^|\s)Menu\s+(.+?)(?=\s+Relevant source files|\s*$)/iu,
	);
	return match?.[1] ? cleanSectionName(match[1]) : undefined;
}
