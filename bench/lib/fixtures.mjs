import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { load as cheerioLoad } from "cheerio";
import { selectAll } from "css-select";
import renderDom from "dom-serializer";
import { getAttributeValue, removeElement, textContent } from "domutils";
import { parseDocument } from "htmlparser2";
import { parseHTML } from "linkedom";

export function createCheerioAdapter() {
	return {
		name: "cheerio",
		load: (html) => cheerioLoad(html),
		select: ($, selector, root) => (root ? root.find(selector) : $(selector)).toArray(),
		text: ($, nodes) => $(nodes).text(),
		attr: ($, node, name) => $(node).attr(name),
		html: ($, nodes) => nodes.map((node) => $.html(node) ?? "").join("\n"),
		remove: ($, nodes) => $(nodes).remove(),
		root: ($) => $.root().toArray(),
	};
}

export function createLinkedomAdapter() {
	return {
		name: "linkedom",
		load: (html) => parseHTML(html).document,
		select: (document, selector, roots) => {
			const base = roots?.length ? roots : [document];
			return base.flatMap((node) => Array.from(node.querySelectorAll?.(selector) ?? []));
		},
		text: (_document, nodes) => nodes.map((node) => node.textContent ?? "").join(""),
		attr: (_document, node, name) => node.getAttribute?.(name) ?? undefined,
		html: (_document, nodes) => nodes.map((node) => node.outerHTML ?? "").join("\n"),
		remove: (_document, nodes) => {
			for (const node of nodes) node.remove?.();
		},
		root: (document) => [document],
	};
}

export function createHtmlparser2Adapter() {
	return {
		name: "htmlparser2+domhandler+css-select+dom-serializer",
		load: (html) =>
			parseDocument(html, {
				lowerCaseTags: true,
				lowerCaseAttributeNames: true,
			}),
		select: (document, selector, roots) =>
			selectAll(selector, roots?.length ? roots : document.children),
		text: (_document, nodes) => textContent(nodes),
		attr: (_document, node, name) => getAttributeValue(node, name),
		html: (_document, nodes) => nodes.map((node) => renderDom(node)).join("\n"),
		remove: (_document, nodes) => {
			for (const node of nodes) removeElement(node);
		},
		root: (document) => document.children,
	};
}

export async function loadHtmlFixtures(dir, fixtureNames = []) {
	const entries = await readdir(dir, { withFileTypes: true });
	const names = new Set(fixtureNames);
	const out = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
		const id = entry.name.replace(/\.html$/u, "");
		if (names.size > 0 && !names.has(id)) continue;
		const full = path.join(dir, entry.name);
		const buffer = await readFile(full);
		out.push({
			path: full,
			html: buffer.toString("utf8"),
			bytes: buffer.byteLength,
		});
	}
	return out;
}

export function clean(value) {
	return String(value ?? "")
		.replaceAll(/\s+/gu, " ")
		.trim();
}

export function flagList(argv, name) {
	const match = argv.find((arg) => arg.startsWith(`--${name}=`));
	if (!match) return [];
	return match
		.split("=")[1]
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}
