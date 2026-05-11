/** @file Extract **tests** ad-hoc.test module. */
import { describe, expect, it } from "vitest";

import { extractAdHoc, MissingExtractInputError } from "../../adhoc/index.ts";
import {
	MissingModelAdapterError,
	type ModelAdapter,
	type ModelResponse,
} from "../../adhoc/model.ts";
import { prepareExtractionInput } from "../../input.ts";

const model: ModelAdapter = {
	run: async <T>(request: Parameters<ModelAdapter["run"]>[0]): Promise<ModelResponse<T>> => ({
		data: {
			title: request.input.includes("Widget") ? "Widget" : "Unknown",
			prompt: request.prompt,
			schema: request.schema,
		} as T,
	}),
};

describe("extractAdHoc", () => {
	it("uses provided clean content and injected model boundary", async () => {
		const schema = { type: "object", properties: { title: { type: "string" } } };
		const result = await extractAdHoc(
			{ content: "# Widget\nGreat product", prompt: "Extract product", schema },
			model,
		);
		expect(result.input.source).toBe("provided");
		expect(result.data).toEqual({ title: "Widget", prompt: "Extract product", schema });
	});

	it("uses a dedicated missing-input error instead of a missing-model error", async () => {
		await expect(prepareExtractionInput({})).rejects.toBeInstanceOf(MissingExtractInputError);
		await expect(prepareExtractionInput({})).rejects.not.toBeInstanceOf(MissingModelAdapterError);
	});
});
