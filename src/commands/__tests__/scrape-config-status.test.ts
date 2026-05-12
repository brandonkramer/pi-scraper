/** @file Web-config-status **tests** module. */
import { describe, expect, it } from "vitest";

import type { ModelResponse } from "../../extract/adhoc/model.ts";
import { modelRegistry } from "../../tools/infra/model-registry.ts";
import { runScrapeConfigStatus } from "../scrape-config-status.ts";

type WebConfigStatusResult = Awaited<ReturnType<typeof runScrapeConfigStatus>>;

function firstContentText(result: WebConfigStatusResult): string {
	return result.content[0]?.text ?? "";
}

describe("runScrapeConfigStatus", () => {
	it("report contains effective config", async () => {
		const result = await runScrapeConfigStatus({ action: "status" }, {});
		const text = firstContentText(result);
		expect(text).toContain("Effective config:");
		expect(text).toContain("scrapeMode:");
	});

	it("report shows registered adapters", async () => {
		modelRegistry.register({
			id: "test-adapter",
			label: "Test Adapter",
			capabilities: ["summarize"],
			priority: 50,
			adapter: {
				async run<T>(_req: unknown, _signal?: unknown): Promise<ModelResponse<T>> {
					return { data: "" as T };
				},
			},
		});
		const result = await runScrapeConfigStatus({ action: "status" }, {});
		const text = firstContentText(result);
		expect(text).toContain("test-adapter");
		expect(text).toContain("priority 50");
		modelRegistry.unregister("test-adapter");
	});

	it("report shows empty registry", async () => {
		modelRegistry.clear();
		const result = await runScrapeConfigStatus({ action: "status" }, {});
		const text = firstContentText(result);
		expect(text).toContain("Registered adapters: 0");
	});

	it("structured data contains report shape", async () => {
		const result = await runScrapeConfigStatus({ action: "status" }, {});
		const details = result.details as {
			data?: {
				effectiveConfig?: unknown;
				registeredAdapters?: unknown[];
				resolutionPrecedence?: unknown[];
			};
		};
		expect(details.data?.effectiveConfig).toBeDefined();
		expect(details.data?.registeredAdapters).toBeDefined();
		expect(details.data?.resolutionPrecedence).toBeDefined();
	});
});
