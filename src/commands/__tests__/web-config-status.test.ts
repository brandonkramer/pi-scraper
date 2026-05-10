/**
 * @fileoverview web-config-status __tests__ module.
 */
import { describe, expect, it } from "vitest";
import { runWebConfigStatus } from "../web-config-status.ts";
import { modelRegistry } from "../../tools/infra/model-registry.ts";

describe("runWebConfigStatus", () => {
	it("report contains effective config", async () => {
		const result = await runWebConfigStatus({ action: "status" }, {});
		const text = result.content[0]?.text ?? "";
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
				async run() {
					return { data: "" };
				},
			},
		});
		const result = await runWebConfigStatus({ action: "status" }, {});
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("test-adapter");
		expect(text).toContain("priority 50");
		modelRegistry.unregister("test-adapter");
	});

	it("report shows empty registry", async () => {
		modelRegistry.clear();
		const result = await runWebConfigStatus({ action: "status" }, {});
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("Registered adapters: 0");
	});

	it("structured data contains report shape", async () => {
		const result = await runWebConfigStatus({ action: "status" }, {});
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
