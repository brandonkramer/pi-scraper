import * as cssSelect from "css-select";
import renderDom from "dom-serializer";
import type { AnyNode, Document } from "domhandler";
import * as domutils from "domutils";
import { parseDocument } from "htmlparser2";
import type { DomAdapter, DomNode, DomSelection } from "./dom-adapter.js";

class Htmlparser2DomSelection implements DomSelection {
	readonly adapterKind = "dom-selection" as const;

	constructor(readonly selection: AnyNode[]) {}
}

/** Loads HTML into the htmlparser2-backed DOM adapter. */
export function loadHtmlparser2Dom(html: string): DomAdapter {
	return new Htmlparser2DomAdapter(
		parseDocument(html, {
			lowerCaseAttributeNames: true,
			lowerCaseTags: true,
		}),
	);
}

class Htmlparser2DomAdapter implements DomAdapter {
	constructor(private readonly document: Document) {}

	root(): DomSelection {
		return this.wrap(this.document.children);
	}

	select(selector: string, scope?: DomSelection): DomSelection {
		return this.wrap(cssSelect.selectAll(selector, this.roots(scope)));
	}

	selection(nodes: DomNode[]): DomSelection {
		return this.wrap(nodes as AnyNode[]);
	}

	first(selection: DomSelection): DomSelection {
		return this.wrap(this.asSelection(selection).slice(0, 1));
	}

	nodes(selection: DomSelection): DomNode[] {
		return [...this.asSelection(selection)];
	}

	count(selection: DomSelection): number {
		return this.asSelection(selection).length;
	}

	text(target: DomSelection | DomNode): string {
		if (target === undefined || target === null) return "";
		if (target instanceof Htmlparser2DomSelection) {
			return domutils.textContent(target.selection);
		}
		return domutils.textContent(target as AnyNode);
	}

	html(selection: DomSelection): string {
		return renderDom(this.asSelection(selection));
	}

	attr(target: DomSelection | DomNode, name: string): string | undefined {
		if (target === undefined || target === null) return undefined;
		const node =
			target instanceof Htmlparser2DomSelection
				? target.selection[0]
				: (target as AnyNode);
		return node && domutils.isTag(node)
			? domutils.getAttributeValue(node, name)
			: undefined;
	}

	tagName(node: DomNode): string | undefined {
		if (node === undefined || node === null) return undefined;
		const maybeNode = node as { name?: unknown };
		return typeof maybeNode.name === "string" ? maybeNode.name : undefined;
	}

	remove(selector: string, scope?: DomSelection): void {
		for (const node of this.asSelection(this.select(selector, scope))) {
			domutils.removeElement(node);
		}
	}

	removeSelection(selection: DomSelection): void {
		for (const node of this.asSelection(selection)) {
			domutils.removeElement(node);
		}
	}

	private roots(scope: DomSelection | undefined): AnyNode[] {
		return scope === undefined
			? this.document.children
			: this.asSelection(scope);
	}

	private wrap(selection: AnyNode[]): DomSelection {
		return new Htmlparser2DomSelection(selection);
	}

	private asSelection(selection: DomSelection): AnyNode[] {
		if (!(selection instanceof Htmlparser2DomSelection)) {
			throw new TypeError(
				"DOM selection belongs to a different adapter backend",
			);
		}
		return selection.selection;
	}
}
