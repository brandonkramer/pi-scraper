import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PI_TRUNCATION_LIMITS } from "../../defaults.js";
import { truncateAndStore } from "../../storage/results.js";
import type { ResultEnvelope } from "../../types.js";
import { webGetResultTool } from "../web-get-result.js";

let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-truncation-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
});

describe("tool retrieval for truncated full output", () => {
	it("stores byte-limited output and retrieves the full payload by responseId", async () => {
		const fullText = `${"x".repeat(PI_TRUNCATION_LIMITS.maxBytes + 1024)}\n${Array.from({ length: PI_TRUNCATION_LIMITS.maxLines + 10 }, (_, index) => `line ${index}`).join("\n")}`;
		const payload = { kind: "large-output", text: fullText };

		const truncated = await truncateAndStore(fullText, payload);

		expect(truncated.truncated).toBe(true);
		expect(truncated.text.length).toBeLessThan(fullText.length);
		expect(truncated.metadata?.responseId).toBeTruthy();
		expect(truncated.metadata?.fullOutputPath).toContain(
			path.join(homeDir, ".pi", "scraper", "results"),
		);

		const retrieved = await webGetResultTool.execute(
			"get-truncated",
			{ responseId: truncated.metadata?.responseId ?? "" },
			new AbortController().signal,
		);
		const envelope = retrieved.details as ResultEnvelope<typeof payload>;

		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.kind).toBe("large-output");
		expect(envelope.data?.text.length).toBe(fullText.length);
	});
});
