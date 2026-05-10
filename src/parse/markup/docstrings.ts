/** @fileoverview Surface-level docstring extraction for source files without typechecking. */
function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined && v !== ""),
	) as T;
}

export type DocstringKind = "function" | "class" | "interface" | "variable";

export interface ParsedDocParam {
	name: string;
	type?: string;
	description?: string;
}

export interface ParsedDocReturn {
	type?: string;
	description?: string;
}

export interface ParsedDocExport {
	name: string;
	kind: DocstringKind;
	signature?: string;
	description?: string;
	parameters?: ParsedDocParam[];
	returns?: ParsedDocReturn;
	examples?: string[];
	lineStart?: number;
	lineEnd?: number;
}

export interface ParsedDocstrings {
	file: string;
	exports: ParsedDocExport[];
}

interface CommentBlock {
	text: string;
	lineStart: number;
	lineEnd: number;
	signature?: string;
}

export function parseDocstrings(
	text: string,
	file = "source",
): ParsedDocstrings {
	const language = file.endsWith(".py") ? "python" : "js";
	const blocks =
		language === "python" ? pythonDocstrings(text) : jsLikeDocstrings(text);
	return {
		file,
		exports: blocks.flatMap((block) => {
			const signature = block.signature ?? signatureAfter(text, block.lineEnd);
			if (!signature) return [];
			const parsed = parseDocBlock(block.text);
			return [
				{
					...parsed,
					...symbolFromSignature(signature),
					signature,
					lineStart: block.lineStart,
					lineEnd: block.lineEnd,
				},
			];
		}),
	};
}

export function docstringsToMarkdown(result: ParsedDocstrings): string {
	const lines = [`# ${result.file}`, ""];
	for (const item of result.exports) {
		lines.push(`## ${item.name}`, "", item.description ?? "");
		if (item.signature) lines.push("", "```", item.signature, "```");
		if (item.parameters?.length) {
			lines.push("", "Parameters:");
			for (const param of item.parameters) {
				lines.push(
					`- ${param.name}${param.type ? ` (${param.type})` : ""}: ${param.description ?? ""}`,
				);
			}
		}
		if (item.returns)
			lines.push(
				"",
				`Returns: ${item.returns.description ?? item.returns.type ?? ""}`,
			);
		for (const example of item.examples ?? [])
			lines.push("", "Example:", "```", example, "```");
		lines.push("");
	}
	return lines.join("\n").trim();
}

function jsLikeDocstrings(text: string): CommentBlock[] {
	const blocks: CommentBlock[] = [];
	for (const match of text.matchAll(/\/\*\*([\s\S]*?)\*\//gu)) {
		const before = text.slice(0, match.index);
		const lineStart = before.split("\n").length;
		const lineEnd = lineStart + (match[0]?.split("\n").length ?? 1) - 1;
		blocks.push({ text: cleanJsDoc(match[1] ?? ""), lineStart, lineEnd });
	}
	return blocks;
}

function pythonDocstrings(text: string): CommentBlock[] {
	const blocks: CommentBlock[] = [];
	const pattern =
		/(?:^|\n)(\s*)((?:def|class)\s+[A-Za-z_][\w]*[\s\S]*?:)\s*\n\1\s{2,}(["']{3})([\s\S]*?)\3/gu;
	for (const match of text.matchAll(pattern)) {
		const quoteIndex =
			(match.index ?? 0) + (match[0]?.lastIndexOf(match[3] ?? "'''") ?? 0);
		const lineStart = text.slice(0, quoteIndex).split("\n").length;
		const lineEnd = lineStart + (match[4]?.split("\n").length ?? 1) - 1;
		blocks.push({
			text: (match[4] ?? "").trim(),
			signature: match[2]?.trim(),
			lineStart,
			lineEnd,
		});
	}
	return blocks;
}

function cleanJsDoc(text: string): string {
	return text
		.split("\n")
		.map((line) => line.replace(/^\s*\* ?/u, ""))
		.join("\n")
		.trim();
}

function signatureAfter(text: string, lineEnd: number): string | undefined {
	const lines = text.split("\n").slice(lineEnd);
	const signatureLines: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("@") || trimmed.startsWith("//"))
			continue;
		signatureLines.push(trimmed);
		if (/[{;:]\s*$/u.test(trimmed) || signatureLines.join(" ").includes("=>"))
			break;
		if (signatureLines.length >= 4) break;
	}
	const signature = signatureLines.join(" ").replace(/\s+/gu, " ").trim();
	return signature || undefined;
}

function parseDocBlock(text: string): Omit<ParsedDocExport, "name" | "kind"> {
	const params: ParsedDocParam[] = [];
	const examples: string[] = [];
	let returns: ParsedDocReturn | undefined;
	const description: string[] = [];
	let currentExample: string[] | undefined;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		const tag = trimmed.match(
			/^@(param|arg|argument|returns?|example)\b\s*(.*)$/u,
		);
		if (!tag) {
			if (currentExample) currentExample.push(line);
			else if (trimmed) description.push(trimmed);
			continue;
		}
		if (currentExample) examples.push(currentExample.join("\n").trim());
		currentExample = undefined;
		const body = tag[2] ?? "";
		if (tag[1] === "example") currentExample = [body].filter(Boolean);
		else if (tag[1]?.startsWith("return")) returns = parseReturn(body);
		else params.push(parseParam(body));
	}
	if (currentExample) examples.push(currentExample.join("\n").trim());
	return withoutUndefined({
		description: description.join("\n"),
		parameters: params.length ? params : undefined,
		returns,
		examples: examples.filter(Boolean),
	});
}

function parseParam(text: string): ParsedDocParam {
	const match = text.match(/^(?:\{([^}]+)\}\s*)?([\w$.[\]-]+)\s*-?\s*(.*)$/u);
	return withoutUndefined({
		name: match?.[2] ?? text.trim(),
		type: match?.[1],
		description: match?.[3]?.trim(),
	});
}

function parseReturn(text: string): ParsedDocReturn {
	const match = text.match(/^(?:\{([^}]+)\}\s*)?(.*)$/u);
	return withoutUndefined({
		type: match?.[1],
		description: match?.[2]?.trim(),
	});
}

function symbolFromSignature(signature: string): {
	name: string;
	kind: DocstringKind;
} {
	const match = signature.match(
		/(?:export\s+)?(?:async\s+)?(?:function|def)\s+([\w$]+)|(?:export\s+)?class\s+([\w$]+)|(?:export\s+)?interface\s+([\w$]+)|(?:export\s+)?(?:const|let|var)\s+([\w$]+)/u,
	);
	const name = match?.slice(1).find(Boolean) ?? "anonymous";
	if (/\bclass\b/u.test(signature)) return { name, kind: "class" };
	if (/\binterface\b/u.test(signature)) return { name, kind: "interface" };
	if (/\b(const|let|var)\b/u.test(signature)) return { name, kind: "variable" };
	return { name, kind: "function" };
}
