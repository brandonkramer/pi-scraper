/**
 * @fileoverview Shared AbortSignal helpers for fetch, browser, and parser adapters.
 */

export function createAbortError(message = "Operation aborted"): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
	return (
		signal?.aborted === true ||
		(error instanceof Error && error.name === "AbortError")
	);
}

export function throwIfAborted(
	signal: AbortSignal | undefined,
	message?: string,
): void {
	if (!signal?.aborted) return;
	throw signal.reason ?? createAbortError(message);
}

export function abortable<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
	message?: string,
): Promise<T> {
	if (!signal) return promise;
	throwIfAborted(signal, message);
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason ?? createAbortError(message));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}
