import { describe, expect, it } from "vitest";

import { buildCategorization, initialReviewValues, reviewTotal } from "./review-model";

describe("import review model", () => {
  it("preserves the exact imported amount across a split", () => {
    const values = {
      bucketEntries: [
        { bucketId: "food", categoryId: "groceries", amount: "-72.35", memo: "" },
        { bucketId: "household", categoryId: "supplies", amount: "-27.65", memo: "soap" },
      ],
    };
    expect(reviewTotal(values)).toEqual({ amount: "-10000", invalid: false });
    expect(buildCategorization(values, "-10000")).toEqual({ bucketEntries: [
      { bucketId: "food", categoryId: "groceries", amount: "-7235", memo: null },
      { bucketId: "household", categoryId: "supplies", amount: "-2765", memo: "soap" },
    ] });
  });

  it("rejects imbalanced and zero entries", () => {
    expect(() => buildCategorization(initialReviewValues("-10000", "food"), "-9999")).toThrow(/add up exactly/i);
    expect(() => buildCategorization({ bucketEntries: [{ bucketId: "food", categoryId: "", amount: "0.00", memo: "" }] }, "0")).toThrow(/cannot be zero/i);
  });
});
