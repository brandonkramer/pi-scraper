/** @file Tests for politeness controller — semaphore permit management under abort. */
import { describe, expect, it } from "vitest";

import { PolitenessController } from "../politeness.ts";

describe("PolitenessController", () => {
	it("global permit is released when host acquire aborts", async () => {
		const controller = new PolitenessController({
			globalConcurrency: 2,
			perHostConcurrency: 1,
		});

		// Saturate host semaphore for "slow.example".
		const slowAbort = new AbortController();
		const slowTask = controller.run(
			"slow.example",
			undefined,
			slowAbort.signal,
			() =>
				new Promise((resolve) => {
					setTimeout(resolve, 200);
				}),
		);

		// Wait for slowTask to acquire both permits.
		await new Promise((resolve) => {
			setTimeout(resolve, 20);
		});

		// Queue a second call to the same host with an abort signal armed.
		const abort = new AbortController();
		const queuedTask = controller.run(
			"slow.example",
			undefined,
			abort.signal,
			async () => "should-not-run",
		);

		// Wait for queuedTask to acquire the global permit and queue on host.
		await new Promise((resolve) => {
			setTimeout(resolve, 20);
		});

		// Abort the queued call.
		abort.abort();
		await expect(queuedTask).rejects.toThrow(/operation was aborted/iu);

		// A NEW call to a DIFFERENT host should still acquire the second global permit.
		const fastTask = controller.run("fast.example", undefined, undefined, async () => "fast-ok");

		await expect(
			Promise.race([
				fastTask,
				new Promise((_, reject) => {
					setTimeout(() => reject(new Error("fastTask deadlocked")), 500);
				}),
			]),
		).resolves.toBe("fast-ok");

		// Clean up slow task — suppress unhandled rejection
		slowAbort.abort();
		void slowTask.catch(() => undefined);
	});

	it("releases both permits when task completes normally", async () => {
		const controller = new PolitenessController({
			globalConcurrency: 1,
			perHostConcurrency: 1,
		});

		const result = await controller.run("example.com", undefined, undefined, async () => "done");
		expect(result).toBe("done");

		// A second call should succeed immediately — both permits released.
		const result2 = await controller.run("example.com", undefined, undefined, async () => "done2");
		expect(result2).toBe("done2");
	});

	it("releases both permits when task throws", async () => {
		const controller = new PolitenessController({
			globalConcurrency: 1,
			perHostConcurrency: 1,
		});

		await expect(
			controller.run("example.com", undefined, undefined, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		// A second call should succeed — both permits released despite error.
		const result = await controller.run(
			"example.com",
			undefined,
			undefined,
			async () => "recovered",
		);
		expect(result).toBe("recovered");
	});

	it("releases both permits when waitTurn aborts", async () => {
		const controller = new PolitenessController({
			globalConcurrency: 1,
			perHostConcurrency: 1,
			minDelayMs: 500,
		});

		// First call sets the host available-at time.
		await controller.run("example.com", undefined, undefined, async () => "first");

		// Second call must wait ~500ms. Abort it immediately.
		const abort = new AbortController();
		const task = controller.run("example.com", undefined, abort.signal, async () => "second");

		abort.abort();
		await expect(task).rejects.toThrow(/operation was aborted/iu);

		// Third call should succeed — permits released despite abort during waitTurn.
		const result = await controller.run("example.com", undefined, undefined, async () => "third");
		expect(result).toBe("third");
	});
});
