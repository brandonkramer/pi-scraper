import { describe, expect, it } from "vitest";
import { progressShell } from "../progress.js";
import { errorResult, toolResult } from "../result.js";

describe("tool result helpers", () => {
  it("builds the standard Pi shell and envelope", () => {
    const result = toolResult({ text: "ok", data: { value: 1 }, url: "https://example.com", mode: "fast" });
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(result.details.url).toBe("https://example.com");
    expect(result.details.mode).toBe("fast");
    expect(result.details.truncated).toBe(false);
    expect(result.details.data).toEqual({ value: 1 });
  });

  it("builds structured error shells", () => {
    const result = errorResult({ code: "NOPE", phase: "test", message: "Nope", retryable: false });
    expect(result.details.error?.code).toBe("NOPE");
    expect(result.content[0]?.text).toBe("Nope");
  });
});

describe("progressShell", () => {
  it("marks progress details", () => {
    const progress = progressShell({ state: "processing", current: 1, total: 3, url: "https://example.com" });
    expect(progress.details._progress).toBe(true);
    expect(progress.details.state).toBe("processing");
    expect(progress.content[0]?.text).toContain("1/3");
  });
});
