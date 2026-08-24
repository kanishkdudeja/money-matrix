import { describe, expect, it } from "vitest";

import { buildRuleCommand, describeConditions, type RuleFormValues } from "./rule-model";

const values: RuleFormValues = {
  name: "  Groceries  ",
  priority: "20",
  descriptionContains: "  MARKET  ",
  direction: "debit",
  minimumAmount: "10.05",
  maximumAmount: "1,250.99",
  bucketId: "bucket-food",
  categoryId: "category-grocery",
};

describe("buildRuleCommand", () => {
  it("converts display thresholds to exact minor-unit integers", () => {
    expect(buildRuleCommand(values)).toEqual({
      name: "Groceries",
      priority: 20,
      conditions: {
        descriptionContains: "MARKET",
        direction: "debit",
        minimumAmount: 1005,
        maximumAmount: 125099,
      },
      bucketId: "bucket-food",
      categoryId: "category-grocery",
      autoApply: false,
    });
  });

  it("requires both a meaningful condition and a suggested result", () => {
    expect(() => buildRuleCommand({ ...values, descriptionContains: "", direction: "", minimumAmount: "", maximumAmount: "" })).toThrow("matching condition");
    expect(() => buildRuleCommand({ ...values, bucketId: "", categoryId: "" })).toThrow("suggested bucket or category");
  });

  it("rejects inverted amount ranges", () => {
    expect(() => buildRuleCommand({ ...values, minimumAmount: "20.00", maximumAmount: "10.00" })).toThrow("must not exceed");
  });
});

describe("describeConditions", () => {
  it("renders direction and amount conditions in human terms", () => {
    expect(describeConditions({ direction: "credit", minimumAmount: 1005 })).toEqual(["Money in", "At least ₹10.05"]);
  });
});
