/**
 * @fileoverview Tests for safe JSONPath subset evaluator.
 */
import { describe, expect, it } from "vitest";
import {
	evaluateJsonPath,
	evaluateJsonPaths,
	flattenJsonValues,
	isSupportedJsonPath,
	parseJsonSafe,
} from "../../selector/json-path.ts";

describe("evaluateJsonPath", () => {
	it("selects root with $", () => {
		const result = evaluateJsonPath({ a: 1 }, "$");
		expect(result.values).toEqual([{ a: 1 }]);
		expect(result.errors).toEqual([]);
	});

	it("selects object property", () => {
		const result = evaluateJsonPath({ name: "test", value: 42 }, "$.name");
		expect(result.values).toEqual(["test"]);
		expect(result.errors).toEqual([]);
	});

	it("selects nested object property", () => {
		const result = evaluateJsonPath({ user: { name: "Alice" } }, "$.user.name");
		expect(result.values).toEqual(["Alice"]);
	});

	it("selects array wildcard", () => {
		const result = evaluateJsonPath(["a", "b", "c"], "$[*]");
		expect(result.values).toEqual(["a", "b", "c"]);
	});

	it("selects array index", () => {
		const result = evaluateJsonPath(["first", "second"], "$[0]");
		expect(result.values).toEqual(["first"]);
	});

	it("selects array index then property", () => {
		const result = evaluateJsonPath(
			[{ name: "a" }, { name: "b" }],
			"$[0].name",
		);
		expect(result.values).toEqual(["a"]);
	});

	it("selects wildcard then property", () => {
		const result = evaluateJsonPath(
			[{ name: "a" }, { name: "b" }],
			"$[*].name",
		);
		expect(result.values).toEqual(["a", "b"]);
	});

	it("returns empty for missing property", () => {
		const result = evaluateJsonPath({ a: 1 }, "$.missing");
		expect(result.values).toEqual([]);
		expect(result.errors).toEqual([]);
	});

	it("returns empty for out-of-bounds index", () => {
		const result = evaluateJsonPath(["a"], "$[5]");
		expect(result.values).toEqual([]);
		expect(result.errors).toEqual([]);
	});

	it("errors for unsupported syntax", () => {
		const result = evaluateJsonPath({ a: 1 }, "$.a[?(@.b>1)]");
		expect(result.values).toEqual([]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.code).toBe("JSON_PATH_UNSUPPORTED");
	});

	it("errors for filter expressions", () => {
		const result = evaluateJsonPath([{ a: 1 }], "$[?(@.a>1)]");
		expect(result.values).toEqual([]);
		expect(result.errors[0]!.code).toBe("JSON_PATH_UNSUPPORTED");
	});

	it("errors for recursive descent", () => {
		const result = evaluateJsonPath({ a: { b: 1 } }, "$..b");
		expect(result.values).toEqual([]);
		expect(result.errors[0]!.code).toBe("JSON_PATH_UNSUPPORTED");
	});

	it("errors for paths not starting with $", () => {
		const result = evaluateJsonPath({ a: 1 }, "a.b");
		expect(result.values).toEqual([]);
		expect(result.errors[0]!.code).toBe("JSON_PATH_UNSUPPORTED");
	});
});

describe("evaluateJsonPaths", () => {
	it("combines multiple paths", () => {
		const result = evaluateJsonPaths({ a: "alpha", b: "beta" }, ["$.a", "$.b"]);
		expect(result.values).toEqual(["alpha", "beta"]);
		expect(result.infos).toEqual([
			{ path: "$.a", matched: 1, missing: false },
			{ path: "$.b", matched: 1, missing: false },
		]);
	});

	it("reports missing paths", () => {
		const result = evaluateJsonPaths({ a: "alpha" }, ["$.a", "$.missing"]);
		expect(result.infos).toEqual([
			{ path: "$.a", matched: 1, missing: false },
			{ path: "$.missing", matched: 0, missing: true },
		]);
	});
});

describe("flattenJsonValues", () => {
	it("flattens strings as-is", () => {
		expect(flattenJsonValues(["hello", "world"])).toBe("hello\nworld");
	});

	it("stringifies numbers and booleans", () => {
		expect(flattenJsonValues([42, true, null])).toBe("42\ntrue\nnull");
	});

	it("flattens arrays recursively", () => {
		expect(flattenJsonValues([["a", "b"], ["c"]])).toBe("a\nb\nc");
	});

	it("flattens objects by values", () => {
		expect(flattenJsonValues([{ x: "a", y: "b" }])).toBe("a\nb");
	});

	it("flattens notebook cell source arrays", () => {
		const cells = [
			{ source: ["import os", "print(1)"] },
			{ source: ["# comment", "x = 2"] },
		];
		const result = evaluateJsonPath(cells, "$[*].source");
		expect(flattenJsonValues(result.values)).toBe(
			"import os\nprint(1)\n# comment\nx = 2",
		);
	});
});

describe("parseJsonSafe", () => {
	it("parses valid JSON", () => {
		const result = parseJsonSafe('{"a":1}');
		expect(result.data).toEqual({ a: 1 });
		expect(result.error).toBeUndefined();
	});

	it("returns structured error for invalid JSON", () => {
		const result = parseJsonSafe("not json");
		expect(result.data).toBeUndefined();
		expect(result.error).toMatchObject({
			code: "JSON_PARSE_FAILED",
			phase: "pattern_extract",
			retryable: false,
		});
	});
});

describe("isSupportedJsonPath", () => {
	it("accepts supported paths", () => {
		expect(isSupportedJsonPath("$")).toBe(true);
		expect(isSupportedJsonPath("$.a")).toBe(true);
		expect(isSupportedJsonPath("$.a.b")).toBe(true);
		expect(isSupportedJsonPath("$[*]")).toBe(true);
		expect(isSupportedJsonPath("$[0]")).toBe(true);
		expect(isSupportedJsonPath("$[*].name")).toBe(true);
	});

	it("rejects unsupported paths", () => {
		expect(isSupportedJsonPath("a.b")).toBe(false);
		expect(isSupportedJsonPath("$..a")).toBe(false);
		expect(isSupportedJsonPath("$[?(@.a>1)]")).toBe(false);
		expect(isSupportedJsonPath("$[0:2]")).toBe(false);
	});
});
