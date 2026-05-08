/**
 * @fileoverview diff __tests__ compare.test module.
 */
import { describe, expect, it } from "vitest";
import { compareSnapshotText } from "../compare.js";

describe("compareSnapshotText", () => {
  it("pairs simple replacements as changed entries", () => {
    const diff = compareSnapshotText("Title: Old product\nStable", "Title: New product\nStable");
    expect(diff.changed).toEqual([
      {
        previous: "Title: Old product",
        current: "Title: New product",
        previousIndex: 0,
        currentIndex: 0,
        similarity: expect.any(Number),
      },
    ]);
    expect(diff.changedCount).toBe(1);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(1);
  });

  it("keeps pure additions out of changed entries", () => {
    const diff = compareSnapshotText("A\nB", "A\nB\nC");
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual(["C"]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(2);
  });

  it("keeps pure removals out of changed entries", () => {
    const diff = compareSnapshotText("A\nB\nC", "A\nC");
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["B"]);
    expect(diff.unchanged).toBe(2);
  });

  it("separates mixed changed, added, and removed lines deterministically", () => {
    const diff = compareSnapshotText(
      "Keep\nPrice: $10\nRemove me\nOld footer",
      "Keep\nPrice: $12\nAdd me\nNew footer",
    );
    expect(diff.changed.map((entry) => [entry.previous, entry.current])).toEqual([
      ["Price: $10", "Price: $12"],
      ["Old footer", "New footer"],
    ]);
    expect(diff.added).toEqual(["Add me"]);
    expect(diff.removed).toEqual(["Remove me"]);
    expect(diff.unchanged).toBe(1);
  });

  it("leaves unrelated replacements as added and removed lines", () => {
    const diff = compareSnapshotText("a\nb", "b\nc");
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual(["c"]);
    expect(diff.removed).toEqual(["a"]);
    expect(diff.unchanged).toBe(1);
  });
});
