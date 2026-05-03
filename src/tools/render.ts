import type { PiToolShell, ResultEnvelope } from "../types.js";
import type { RenderTheme } from "./define.js";

export function renderSimpleCall(name: string, parts: Array<string | undefined>, theme?: RenderTheme): string {
  const text = `${name} ${parts.filter(Boolean).join(" ")}`.trim();
  return theme?.fg?.("accent", text) ?? text;
}

export function renderEnvelopeResult(result: PiToolShell, expanded = false): string {
  const details = result.details as Partial<ResultEnvelope<unknown>> | undefined;
  const status = details?.status ? `${details.status}` : "done";
  const id = details?.responseId ? ` · responseId: ${details.responseId}` : "";
  const url = details?.finalUrl ?? details?.url;
  const preview = result.content[0]?.text ?? "";
  if (!expanded) return `${status}${url ? ` · ${url}` : ""}${id}`;
  return `${status}${url ? ` · ${url}` : ""}${id}\n${preview.slice(0, 500)}`;
}

export function summarizeData(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  return String(value ?? "done");
}
