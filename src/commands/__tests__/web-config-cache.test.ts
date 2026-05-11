/** @file Web-config-cache **tests** module. */
import { describe, expect, it } from "vitest";

import { runWebConfigCache } from "../web-config-cache.ts";

type WebConfigCacheResult = Awaited<ReturnType<typeof runWebConfigCache>>;

function firstContentText(result: WebConfigCacheResult): string {
	return result.content[0]?.text ?? "";
}

describe("runWebConfigCache", () => {
	it("stats returns counts and bytes", async () => {
		const result = await runWebConfigCache({ action: "cache", op: "stats" }, {});
		const text = firstContentText(result);
		expect(text).toContain("Results:");
		expect(text).toContain("Snapshots:");
	});

	it("clear without confirm requires --force", async () => {
		const result = await runWebConfigCache({ action: "cache", op: "clear" }, {});
		expect(result.content[0]?.text).toContain("--force");
	});

	it("clear with --force bypasses confirm", async () => {
		const result = await runWebConfigCache({ action: "cache", op: "clear", force: true }, {});
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
		const result = await runWebConfigCache({ action: "cache", op: "clear" }, ctx);
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
		const result = await runWebConfigCache({ action: "cache", op: "clear" }, ctx);
		expect(result.content[0]?.text).toContain("Cleared");
	});
});
