/**
 * @fileoverview http timeout module.
 */
export function withTimeout(parentSignal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason ?? new DOMException("Operation aborted", "AbortError"));
  const timer = setTimeout(() => controller.abort(new DOMException("Operation timed out", "AbortError")), timeoutMs);
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  };
}
