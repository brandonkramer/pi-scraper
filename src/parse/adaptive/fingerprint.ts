/**
 * @fileoverview Serialize htmlparser2/domhandler nodes into stable element fingerprints.
 *
 * @remarks
 * Fingerprints are portable JSON shapes used for adaptive selector repair.
 * They capture tag, attributes, text content, DOM path, parent signature, and
 * sibling/child tag sequences — enough to relocate an element after markup changes.
 */
import type { AnyNode, Element } from "domhandler";
import * as domutils from "domutils";

/** Attributes that change frequently and should be ignored by default. */
const VOLATILE_ATTRS = new Set([
	"data-reactroot",
	"data-react-checksum",
	"data-nextjs-page",
	"data-nuxt-ssr-id",
	"data-v-app",
	"data-astro-cid",
	"data-sveltekit-preload-data",
	"nonce",
	"data-timestamp",
	"data-tracking-id",
	"data-testid",
]);

/**
 * Portable JSON shape representing an element's structural fingerprint.
 */
export interface ElementFingerprint {
	/** Element tag name, lowercased. */
	tag: string;

	/** Normalized attribute map (empty values and volatile attrs removed). */
	attributes: Record<string, string>;

	/** Direct text content of the element (no children). */
	text?: string;

	/** Full recursive text content including children. */
	fullText?: string;

	/** Ancestor tag path from root to this element. */
	path: string[];

	/** Parent element signature, when present. */
	parent?: {
		tag: string;
		attributes: Record<string, string>;
		text?: string;
	};

	/** Tag names of sibling elements under the same parent. */
	siblings?: string[];

	/** Tag names of direct children. */
	children?: string[];
}

/**
 * Build a fingerprint from a domhandler Element node.
 *
 * @param element — htmlparser2 Element node
 * @returns portable fingerprint
 */
export function fingerprintElement(element: Element): ElementFingerprint {
	const tag = element.name.toLowerCase();
	const attributes = cleanAttributes(element.attribs);
	const text = cleanText(domutils.getText(element));
	const fullText = cleanText(domutils.textContent(element));
	const path = buildPath(element);
	const parent = buildParent(element);
	const siblings = buildSiblings(element);
	const children = buildChildren(element);

	const result: ElementFingerprint = { tag, attributes, path };
	if (text) result.text = text;
	if (fullText && fullText !== text) result.fullText = fullText;
	if (parent) result.parent = parent;
	if (siblings) result.siblings = siblings;
	if (children) result.children = children;
	return result;
}

/**
 * Remove empty/whitespace-only values and volatile framework attributes.
 */
function cleanAttributes(
	attribs: Record<string, string> | undefined,
): Record<string, string> {
	if (!attribs) return {};
	const cleaned: Record<string, string> = {};
	for (const [key, value] of Object.entries(attribs)) {
		const trimmed = value.trim();
		if (!trimmed) continue;
		if (VOLATILE_ATTRS.has(key.toLowerCase())) continue;
		cleaned[key.toLowerCase()] = trimmed;
	}
	return cleaned;
}

/**
 * Collapse whitespace and trim.
 */
function cleanText(text: string | undefined | null): string | undefined {
	if (!text) return undefined;
	const collapsed = text.replace(/\s+/gu, " ").trim();
	return collapsed.length > 0 ? collapsed : undefined;
}

/**
 * Build ancestor tag path from document root to this element.
 */
function buildPath(element: Element): string[] {
	const path: string[] = [];
	let current: AnyNode | null = element;
	while (current) {
		if (domutils.isTag(current)) {
			path.unshift(current.name.toLowerCase());
		}
		current = current.parent ?? null;
	}
	return path;
}

/**
 * Capture parent element signature when available.
 */
function buildParent(
	element: Element,
): ElementFingerprint["parent"] | undefined {
	const parent = element.parent;
	if (!parent || !domutils.isTag(parent)) return undefined;
	return {
		tag: parent.name.toLowerCase(),
		attributes: cleanAttributes(parent.attribs),
		text: cleanText(domutils.textContent(parent)) ?? undefined,
	};
}

/**
 * Tag names of sibling elements (excluding text/comments).
 */
function buildSiblings(element: Element): string[] | undefined {
	const parent = element.parent;
	if (!parent || !parent.children) return undefined;
	const siblings = parent.children
		.filter((child) => child !== element && domutils.isTag(child))
		.map((child) => (child as Element).name.toLowerCase());
	return siblings.length > 0 ? siblings : undefined;
}

/**
 * Tag names of direct child elements (excluding text/comments).
 */
function buildChildren(element: Element): string[] | undefined {
	if (!element.children) return undefined;
	const children = element.children
		.filter((child) => domutils.isTag(child))
		.map((child) => (child as Element).name.toLowerCase());
	return children.length > 0 ? children : undefined;
}
