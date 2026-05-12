/** @file Web-config-cache **tests** module. */
import { describe, expect, it } from "vitest";

import { runScrapeConfigCache } from "../scrape-config-cache.ts";

type WebConfigCacheResult = Awaited<ReturnType<typeof runScrapeConfigCache>>;

function firstContentText(result: WebConfigCacheResult): string {
	return result.content[0]?.text ?? "";
}

describe("runScrapeConfigCache", () => {
	it("stats returns counts and bytes", async () => {
		const result = await runScrapeConfigCache({ action: "cache", op: "stats" }, {});
		const text = firstContentText(result);
		expect(text).toContain("Results:");
		expect(text).toContain("Snapshots:");
	});

	it("clear without confirm requires --force", async () => {
		const result = await runScrapeConfigCache({ action: "cache", op: "clear" }, {});
		expect(result.content[0]?.text).toContain("--force");
	});

	it("clear with --force bypasses confirm", async () => {
		const result = await runScrapeConfigCache({ action: "cache", op: "clear", force: true }, {});
		expect(result.content[0]?.text).toContain("Cleared");
	});

	it("clear with declined confirm cancels", async () => {
		const ctx = {
			ui: {
				notify() {
					/* no-op */
				},
				async confirm() {
					return false;
				},
			},
		};
		const result = await runScrapeConfigCache({ action: "cache", op: "clear" }, ctx);
		expect(result.content[0]?.text).toContain("cancelled");
	});

	it("clear with accepted confirm proceeds", async () => {
		const ctx = {
			ui: {
				notify() {
					/* no-op */
				},
				async confirm() {
					return true;
				},
			},
		};
		const result = await runScrapeConfigCache({ action: "cache", op: "clear" }, ctx);
		expect(result.content[0]?.text).toContain("Cleared");
	});
});
