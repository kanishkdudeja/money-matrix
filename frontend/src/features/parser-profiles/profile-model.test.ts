import { describe, expect, it } from "vitest";

import { buildParserProfile, type ProfileFormValues } from "./profile-model";

const base: ProfileFormValues = {
  name: "  HDFC savings  ",
  institution: " HDFC ",
  parserVersion: " 2026-08 ",
  amountMode: "signed",
  dateColumn: "Date",
  descriptionColumn: "Narration",
  referenceColumn: "Reference",
  amountColumn: "Amount",
  debitColumn: "Debit",
  creditColumn: "Credit",
  balanceColumn: "Balance",
  dateFormat: "02/01/2006",
};

describe("buildParserProfile", () => {
  it("builds a reusable signed-amount CSV mapping", () => {
    expect(buildParserProfile(base)).toEqual({
      name: "HDFC savings",
      institution: "HDFC",
      format: "csv",
      parserVersion: "2026-08",
      mapping: {
        dateColumn: "Date",
        descriptionColumn: "Narration",
        referenceColumn: "Reference",
        amountColumn: "Amount",
        debitColumn: "",
        creditColumn: "",
        balanceColumn: "Balance",
        dateFormat: "02/01/2006",
      },
    });
  });

  it("keeps split debit/credit columns and rejects incomplete mappings", () => {
    const profile = buildParserProfile({ ...base, amountMode: "split", amountColumn: "" });
    expect(profile.mapping).toMatchObject({ amountColumn: "", debitColumn: "Debit", creditColumn: "Credit" });
    expect(() => buildParserProfile({ ...base, dateColumn: "" })).toThrow("date and description");
  });
});
