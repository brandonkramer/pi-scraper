import type { Cheerio, CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { loadHtmlparser2Dom } from "./htmlparser2-dom-adapter.js";

/** Opaque DOM node handle owned by a {@link DomAdapter}. */
export type DomNode = unknown;

/** Opaque DOM selection handle owned by a {@link DomAdapter}. */
export interface DomSelection {
	readonly adapterKind: "dom-selection";
}

/**
 * Narrow DOM operation surface used by static HTML extraction code.
 *
 * @remarks
 * The boundary intentionally models only operations pi-scraper needs. It is not
 * a public DOM API and should not grow jQuery-specific helpers such as
 * `:contains`, traversal chains, or mutation shortcuts unless a production
 * parser call site proves they are required.
 *
 * Selector strings should stay within portable CSS selector syntax. Cheerio-only
 * or jQuery-only selector extensions require an explicit call-site rewrite or a
 * documented adapter method before they are used through this boundary.
 */
export type DomBackend = "htmlparser2" | "cheerio";

export interface DomAdapter {
	root(): DomSelection;
	select(selector: string, scope?: DomSelection): DomSelection;
	selection(nodes: DomNode[]): DomSelection;
	first(selection: DomSelection): DomSelection;
	nodes(selection: DomSelection): DomNode[];
	count(selection: DomSelection): number;
	text(target: DomSelection | DomNode): string;
	html(selection: DomSelection): string;
	attr(target: DomSelection | DomNode, name: string): string | undefined;
	/** Returns the backend's element tag name for portable element-type checks. */
	tagName(node: DomNode): string | undefined;
	remove(selector: string, scope?: DomSelection): void;
	removeSelection(selection: DomSelection): void;
}

/** Loads HTML into the configured production DOM adapter backend. */
export function loadDom(html: string): DomAdapter {
	return loadDomWithBackend(html, defaultDomBackend());
}

/** Loads HTML with an explicit backend for tests and rollback-sensitive callers. */
export function loadDomWithBackend(
	html: string,
	backend: DomBackend,
): DomAdapter {
	return backend === "cheerio"
		? loadCheerioDom(html)
		: loadHtmlparser2Dom(html);
}

/** Returns the configured DOM backend, defaulting to htmlparser2. */
export function defaultDomBackend(): DomBackend {
	return process.env.PI_SCRAPER_DOM_BACKEND === "cheerio"
		? "cheerio"
		: "htmlparser2";
}

/** Loads HTML into the Cheerio-backed fallback DOM adapter. */
export function loadCheerioDom(html: string): DomAdapter {
	return new CheerioDomAdapter(cheerio.load(html));
}

class CheerioDomSelection implements DomSelection {
	readonly adapterKind = "dom-selection" as const;

	constructor(readonly selection: Cheerio<AnyNode>) {}
}

class CheerioDomAdapter implements DomAdapter {
	constructor(private readonly $: CheerioAPI) {}

	root(): DomSelection {
		return this.wrap(this.$.root());
	}

	select(selector: string, scope?: DomSelection): DomSelection {
		if (scope === undefined) return this.wrap(this.$(selector));
		return this.wrap(this.asSelection(scope).find(selector));
	}

	selection(nodes: DomNode[]): DomSelection {
		return this.wrap(this.$(nodes as AnyNode[]));
	}

	first(selection: DomSelection): DomSelection {
		return this.wrap(this.asSelection(selection).first());
	}

	nodes(selection: DomSelection): DomNode[] {
		return this.asSelection(selection).toArray();
	}

	count(selection: DomSelection): number {
		return this.asSelection(selection).length;
	}

	text(target: DomSelection | DomNode): string {
		if (target === undefined || target === null) return "";
		if (target instanceof CheerioDomSelection) return target.selection.text();
		return this.$(target as AnyNode).text();
	}

	html(selection: DomSelection): string {
		return this.asSelection(selection)
			.toArray()
			.map((node) => this.$.html(node))
			.join("\n");
	}

	attr(target: DomSelection | DomNode, name: string): string | undefined {
		if (target === undefined || target === null) return undefined;
		if (target instanceof CheerioDomSelection) {
			return target.selection.first().attr(name);
		}
		return this.$(target as AnyNode).attr(name);
	}

	tagName(node: DomNode): string | undefined {
		if (node === undefined || node === null) return undefined;
		const maybeNode = node as { tagName?: unknown; name?: unknown };
		if (typeof maybeNode.tagName === "string") return maybeNode.tagName;
		if (typeof maybeNode.name === "string") return maybeNode.name;
		return undefined;
	}

	remove(selector: string, scope?: DomSelection): void {
		const targets =
			scope === undefined
				? this.$(selector)
				: this.asSelection(scope).find(selector);
		targets.remove();
	}

	removeSelection(selection: DomSelection): void {
		this.asSelection(selection).remove();
	}

	private wrap(selection: Cheerio<AnyNode>): DomSelection {
		return new CheerioDomSelection(selection);
	}

	private asSelection(selection: DomSelection): Cheerio<AnyNode> {
		if (!(selection instanceof CheerioDomSelection)) {
			throw new TypeError(
				"DOM selection belongs to a different adapter backend",
			);
		}
		return selection.selection;
	}
}
