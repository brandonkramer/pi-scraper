/**
 * @fileoverview http errors module.
 */
import type { StructuredError } from "../types.js";

export class HttpClientError extends Error {
  constructor(readonly structured: StructuredError, cause?: unknown) {
    super(structured.message);
    this.name = "HttpClientError";
    this.cause = cause;
  }
}
