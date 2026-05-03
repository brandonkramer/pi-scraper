import type { PiToolShell, ResultEnvelope } from "../types.js";
import type { RenderComponent, RenderTheme } from "./define.js";

class TextRenderComponent implements RenderComponent {
	constructor(private readonly text: string) {}

	render(_width: number): string[] {
		return this.text.split("\n");
	}

	invalidate(): void {
		// Static text renderers have no cached state to clear.
	}
}

export function renderText(text: string): RenderComponent {
	return new TextRenderComponent(text);
}

export function renderSimpleCall(
	name: string,
	parts: Array<string | undefined>,
	theme?: RenderTheme,
): RenderComponent {
	const text = `${name} ${parts.filter(Boolean).join(" ")}`.trim();
	return renderText(theme?.fg?.("accent", text) ?? text);
}

export function renderEnvelopeResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| undefined;
	const status = details?.status ? `${details.status}` : "done";
	const id = details?.responseId ? ` · responseId: ${details.responseId}` : "";
	const url = details?.finalUrl ?? details?.url;
	const preview = result.content[0]?.text ?? "";
	const summary = `${status}${url ? ` · ${url}` : ""}${id}`;
	return renderText(
		expanded ? `${summary}\n${preview.slice(0, 500)}` : summary,
	);
}

export function summarizeData(value: unknown): string {
	if (Array.isArray(value))
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (value && typeof value === "object")
		return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
	return String(value ?? "done");
}
