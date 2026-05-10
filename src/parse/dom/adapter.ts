/**
 * @fileoverview parse dom-adapter module.
 */
import { loadHtmlparser2Dom } from "../dom/htmlparser2.ts";

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
 * Selector strings should stay within portable CSS selector syntax.
 */
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

/** Loads HTML into the htmlparser2-backed DOM adapter. */
export function loadDom(html: string): DomAdapter {
	return loadHtmlparser2Dom(html);
}
