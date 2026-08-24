import { describe, expect, it } from "vitest";

import { compareAmounts, formatMoney, negateAmount, parseDisplayAmount, sumAmounts, toDisplayAmount } from "./money";

describe("money helpers", () => {
  it("parses familiar rupee input into exact paise", () => {
    expect(parseDisplayAmount("₹1,23,456.78")).toBe("12345678");
    expect(parseDisplayAmount("-.5")).toBe("-50");
    expect(parseDisplayAmount("12.")).toBe("1200");
    expect(parseDisplayAmount("-0.00")).toBe("0");
  });

  it("rejects ambiguous or over-precise input", () => {
    expect(() => parseDisplayAmount("12.345")).toThrow(/two decimal places/i);
    expect(() => parseDisplayAmount("one hundred")).toThrow(/two decimal places/i);
  });

  it("formats INR using Indian digit grouping", () => {
    expect(formatMoney("12345678")).toBe("₹1,23,456.78");
    expect(formatMoney("-50")).toBe("−₹0.50");
    expect(formatMoney("250", { showPlus: true })).toBe("+₹2.50");
  });

  it("uses bigint for arithmetic beyond Number's safe range", () => {
    expect(sumAmounts(["9007199254740993", "7", "-2"])).toBe("9007199254740998");
    expect(negateAmount("9007199254740993")).toBe("-9007199254740993");
    expect(compareAmounts("9007199254740993", "9007199254740992")).toBe(1);
  });

  it("converts minor units back to an editable decimal string", () => {
    expect(toDisplayAmount("-45005")).toBe("-450.05");
    expect(toDisplayAmount("7")).toBe("0.07");
  });
});
