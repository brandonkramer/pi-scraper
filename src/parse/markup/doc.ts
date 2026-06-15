/** @file Lightweight markdown/MDX/RST structure extraction for raw documentation files. */

export type MarkupDocFormat = "markdown" | "mdx" | "rst";

export interface MarkupHeading {
	level: number;
	text: string;
	line: number;
}

export interface MarkupCodeBlock {
	language?: string;
	value: string;
	lineStart: number;
	lineEnd: number;
}

export interface MarkupLink {
	text: string;
	href: string;
	line: number;
}

export interface MdxComponent {
	name: string;
	line: number;
	attributes?: string;
}

export interface MarkupDocument {
	format: MarkupDocFormat;
	file?: string;
	frontmatter?: Record<string, string | boolean | number | string[]>;
	headings: MarkupHeading[];
	codeBlocks: MarkupCodeBlock[];
	links: MarkupLink[];
	components?: MdxComponent[];
	directives?: Array<{ name: string; value?: string; line: number }>;
	text: string;
	markdown: string;
}

export function parseMarkdown(text: string, file?: string): MarkupDocument {
	const { body, frontmatter } = splitFrontmatter(text);
	return parseMarkdownBody(body, "markdown", file, frontmatter);
}

export function parseMdx(text: string, file?: string): MarkupDocument {
	const { body, frontmatter } = splitFrontmatter(text);
	const components = extractMdxComponents(body);
	const stripped = stripMdxJsx(body);
	return {
		...parseMarkdownBody(stripped, "mdx", file, frontmatter),
		components,
	};
}

export function parseRst(text: string, file?: string): MarkupDocument {
	const lines = text.replaceAll(/\r\n?/gu, "\n").split("\n");
	const headings: MarkupHeading[] = [];
	const codeBlocks: MarkupCodeBlock[] = [];
	const directives: NonNullable<MarkupDocument["directives"]> = [];
	const markdownLines: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const next = lines[index + 1] ?? "";
		if (line.trim() && isRstUnderline(next, line.trim().length)) {
			// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
			const level = rstHeadingLevel(next.trim()[0] ?? "=");
			headings.push({ level, text: line.trim(), line: index + 1 });
			markdownLines.push(`${"#".repeat(level)} ${line.trim()}`);
			index += 1;
			continue;
		}
		const directive = line.match(/^\.\.\s+([A-Za-z0-9_-]+)::\s*(.*)$/u);
		if (directive) {
			const name = directive[1] || "directive";
			const value = directive[2]?.trim() || undefined;
			directives.push({ name, value, line: index + 1 });
			if (["code-block", "code", "sourcecode"].includes(name)) {
				const block = collectIndentedBlock(lines, index + 1);
				codeBlocks.push({
					language: value,
					value: block.value,
					lineStart: block.lineStart,
					lineEnd: block.lineEnd,
				});
				markdownLines.push(`\n\`\`\`${value ?? ""}\n${block.value}\n\`\`\``);
				index = Math.max(index, block.lineEnd - 1);
			}
			continue;
		}
		markdownLines.push(line);
	}
	const markdown = markdownLines.join("\n").trim();
	return {
		format: "rst",
		file,
		headings,
		codeBlocks,
		links: extractMarkdownLinks(markdown),
		directives,
		text: plainTextFromMarkdown(markdown),
		markdown,
	};
}

function parseMarkdownBody(
	body: string,
	format: MarkupDocFormat,
	file: string | undefined,
	frontmatter?: MarkupDocument["frontmatter"],
): MarkupDocument {
	return {
		format,
		file,
		frontmatter,
		headings: extractMarkdownHeadings(body),
		codeBlocks: extractMarkdownCodeBlocks(body),
		links: extractMarkdownLinks(body),
		text: plainTextFromMarkdown(body),
		markdown: body.trim(),
	};
}

function splitFrontmatter(text: string): {
	body: string;
	frontmatter?: MarkupDocument["frontmatter"];
} {
	const normalized = text.replaceAll(/\r\n?/gu, "\n");
	if (!normalized.startsWith("---\n")) return { body: normalized };
	const end = normalized.indexOf("\n---", 4);
	if (end < 0) return { body: normalized };
	return {
		frontmatter: parseYamlPairs(normalized.slice(4, end)),
		body: normalized.slice(end + 4).replace(/^\n/u, ""),
	};
}

function parseYamlPairs(text: string): MarkupDocument["frontmatter"] {
	const values: MarkupDocument["frontmatter"] = {};
	for (const line of text.split("\n")) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
		if (!match) continue;
		values[match[1] || ""] = parseYamlScalar(match[2] || "");
	}
	return values;
}

function parseYamlScalar(value: string): string | boolean | number | string[] {
	const trimmed = value.trim().replaceAll(/^['"]|['"]$/gu, "");
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+(\.\d+)?$/u.test(trimmed)) return Number(trimmed);
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return trimmed
			.slice(1, -1)
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return trimmed;
}

export function extractMarkdownHeadings(text: string): MarkupHeading[] {
	return text.split("\n").flatMap((line, index) => {
		const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/u);
		return match
			? [
					{
						level: match[1]?.length || 1,
						text: match[2] || "",
						line: index + 1,
					},
				]
			: [];
	});
}

function extractMarkdownCodeBlocks(text: string): MarkupCodeBlock[] {
	const blocks: MarkupCodeBlock[] = [];
	const lines = text.split("\n");
	let open: { fence: string; language?: string; lineStart: number } | undefined;
	let value: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const fence = line.match(/^(```|~~~)\s*([^`]*)$/u);
		if (!open && fence) {
			open = {
				fence: fence[1] || "```",
				language: fence[2]?.trim() || undefined,
				lineStart: index + 1,
			};
			value = [];
			continue;
		}
		if (open && line.startsWith(open.fence)) {
			blocks.push({
				language: open.language,
				value: value.join("\n"),
				lineStart: open.lineStart,
				lineEnd: index + 1,
			});
			open = undefined;
			continue;
		}
		if (open) value.push(line);
	}
	return blocks;
}

function extractMarkdownLinks(text: string): MarkupLink[] {
	const links: MarkupLink[] = [];
	for (const [index, line] of text.split("\n").entries()) {
		for (const match of line.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
			links.push({
				text: match[1] || "",
				href: match[2] || "",
				line: index + 1,
			});
		}
	}
	return links;
}

function extractMdxComponents(text: string): MdxComponent[] {
	return text.split("\n").flatMap((line, index) => {
		const match = line.match(/^\s*<([A-Z][A-Za-z0-9.]*)\b([^>]*)\/?>(?:\s*)$/u);
		return match
			? [
					{
						name: match[1] || "Component",
						attributes: match[2]?.trim() || undefined,
						line: index + 1,
					},
				]
			: [];
	});
}

function stripMdxJsx(text: string): string {
	return text
		.replaceAll(/^\s*import\s+.*$/gmu, "")
		.replaceAll(/^\s*export\s+.*$/gmu, "")
		.replaceAll(/^\s*<[A-Z][\s\S]*?>\s*$/gmu, "")
		.replaceAll(/<\/?[A-Z][A-Za-z0-9.]*\b[^>]*>/gu, "");
}

function plainTextFromMarkdown(text: string): string {
	return text
		.replaceAll(/```[\s\S]*?```/gu, " ")
		.replaceAll(/^#{1,6}\s+/gmu, "")
		.replaceAll(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
		.replaceAll(/[*_`>~-]/gu, " ")
		.replaceAll(/\s+/gu, " ")
		.trim();
}

function isRstUnderline(line: string, width: number): boolean {
	const trimmed = line.trim();
	return trimmed.length >= Math.max(3, width) && /^([=\-~^"#*+])\1+$/u.test(trimmed);
}

function rstHeadingLevel(marker: string): number {
	return { "=": 1, "-": 2, "~": 3, "^": 4, '"': 5 }[marker] ?? 6;
}

function collectIndentedBlock(
	lines: string[],
	start: number,
): { value: string; lineStart: number; lineEnd: number } {
	const value: string[] = [];
	let lineStart = start + 1;
	let lineEnd = start;
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim() && value.length === 0) {
			lineStart = index + 2;
			continue;
		}
		if (!/^\s{2,}/u.test(line) && line.trim()) break;
		value.push(line.replace(/^\s{2,4}/u, ""));
		lineEnd = index + 1;
	}
	return { value: value.join("\n").trim(), lineStart, lineEnd };
}
