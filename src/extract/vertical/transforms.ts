/**
 * @file Shared generic transforms plus the built-in vertical-specific transform registry. Kept out
 *   of the generic walkers (json-walk, http-workflow) so the engine core carries no provider names
 *   — built-in verticals register their domain transforms here instead.
 */

type AnyRecord = Record<string, unknown>;

/** Generic: prepend `base` to a root-relative path; pass absolute URLs through unchanged. */
export function absoluteUrl(value: unknown, base: string): string | undefined {
	if (typeof value !== "string" || !value) return undefined;
	return value.startsWith("/") ? `${base}${value}` : value;
}

export interface BuiltinTransformCtx {
	language?: string;
	track?: unknown;
}

export type BuiltinTransform = (value: unknown, ctx: BuiltinTransformCtx) => unknown;

/** Built-in vertical-specific transforms, keyed by name. Referenced by manifests via `transform`. */
export const builtinTransforms: ReadonlyMap<string, BuiltinTransform> = new Map<
	string,
	BuiltinTransform
>([
	["runsText", (value) => runsText(value)],
	["youtubeCaptionTrack", (value, ctx) => youtubeCaptionTrack(value, ctx.language ?? "")],
	["youtubeTranscript", (value, ctx) => youtubeTranscript(value, ctx.track)],
]);

/** YouTube/InnerTube text node: `{ simpleText }` or `{ runs: [{ text }] }` → flat string. */
function runsText(value: unknown): string | undefined {
	const object = record(value);
	if (!object) return undefined;
	if (typeof object.simpleText === "string") return object.simpleText;
	const runs = Array.isArray(object.runs) ? object.runs : [];
	const text = runs
		.map((run) => {
			const runObject = record(run);
			return typeof runObject?.text === "string" ? runObject.text : "";
		})
		.join("");
	return text || undefined;
}

function youtubeCaptionTrack(value: unknown, language: string): unknown {
	if (!Array.isArray(value)) return undefined;
	return (
		value.find(
			(track) =>
				trackField(track, "languageCode") === language && trackField(track, "kind") !== "asr",
		) ??
		value.find((track) => trackField(track, "languageCode") === language) ??
		value.find((track) => trackField(track, "kind") !== "asr") ??
		value[0]
	);
}

function youtubeTranscript(raw: unknown, track: unknown): unknown {
	if (typeof raw !== "string" || !record(track)) return undefined;
	const segments = [...raw.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu)]
		.map((match) => ({
			text: decodeEntities(stripTags(match[2])).trim(),
			start: Number.parseFloat(attr(match[1], "start") ?? "0"),
			duration: Number.parseFloat(attr(match[1], "dur") ?? "0"),
		}))
		.filter((segment) => segment.text);
	if (segments.length === 0) return undefined;
	return {
		languageCode: trackField(track, "languageCode"),
		languageName: captionName(track),
		isGenerated: trackField(track, "kind") === "asr",
		segments,
		text: segments.map((segment) => segment.text).join("\n"),
	};
}

function captionName(track: unknown): string | undefined {
	const name = readPath(track, "name.simpleText");
	if (typeof name === "string") return name;
	const runs = readPath(track, "name.runs");
	return Array.isArray(runs)
		? runs.map((run) => valueToString(readPath(run, "text"))).join("")
		: undefined;
}

function trackField(track: unknown, field: string): string | undefined {
	const value = readPath(track, field);
	return typeof value === "string" ? value : undefined;
}

function attr(attrs: string | undefined, name: string): string | undefined {
	return new RegExp(`${name}="([^"]*)"`, "u").exec(attrs ?? "")?.[1];
}

function decodeEntities(value: string): string {
	return value.replaceAll(
		/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/giu,
		(match, dec: string, hex: string, named: string) => {
			if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
			if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
			return (
				({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[named] ??
				match
			);
		},
	);
}

function stripTags(value: string): string {
	return value.replaceAll(/<[^>]+>/gu, "");
}

function record(value: unknown): AnyRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as AnyRecord)
		: undefined;
}

function readPath(value: unknown, path: string): unknown {
	if (!path) return value;
	let current = value;
	for (const part of path.split(".").filter(Boolean)) {
		if (current === undefined || current === null) return undefined;
		const match = /^(.+)\[(\d+)\]$/u.exec(part);
		if (match) {
			const array = (current as AnyRecord)[match[1]];
			current = Array.isArray(array) ? array[Number(match[2])] : undefined;
		} else {
			current = (current as AnyRecord)[part];
		}
	}
	return current;
}

function valueToString(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
		return String(value);
	return "";
}
