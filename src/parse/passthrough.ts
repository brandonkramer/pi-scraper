import type { BinaryDownloadMetadata } from "../http/download.js";

export type RoutedContentKind = "text" | "markdown" | "json" | "xml" | "svg" | "html" | "pdf" | "binary";

export interface ContentRoute {
  kind: RoutedContentKind;
  shouldParseHtml: boolean;
  shouldExtractPdf: boolean;
  isTextLike: boolean;
}

export interface BinaryAttachmentInfo extends BinaryDownloadMetadata {
  kind: "binary";
  filename?: string;
}

export function routeContentType(contentType: string | undefined, url = ""): ContentRoute {
  const type = (contentType ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const path = url.toLowerCase();
  const kind = classify(type, path);
  return {
    kind,
    shouldParseHtml: kind === "html",
    shouldExtractPdf: kind === "pdf",
    isTextLike: ["text", "markdown", "json", "xml", "svg", "html"].includes(kind),
  };
}

export function parseJsonText(text: string): unknown {
  return JSON.parse(text);
}

export function binaryAttachmentInfo(file: BinaryDownloadMetadata, filename?: string): BinaryAttachmentInfo {
  return { ...file, kind: "binary", filename };
}

function classify(type: string, path: string): RoutedContentKind {
  if (type === "application/pdf" || path.endsWith(".pdf")) return "pdf";
  if (type === "text/html" || type === "application/xhtml+xml" || path.endsWith(".html")) return "html";
  if (type.includes("markdown") || path.endsWith(".md") || path.endsWith(".markdown")) return "markdown";
  if (type.includes("json") || path.endsWith(".json")) return "json";
  if (type.includes("svg") || path.endsWith(".svg")) return "svg";
  if (type.includes("xml") || path.endsWith(".xml")) return "xml";
  if (type.startsWith("text/") || path.endsWith(".txt")) return "text";
  return "binary";
}
