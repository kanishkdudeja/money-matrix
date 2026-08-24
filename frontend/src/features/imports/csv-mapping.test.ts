import { describe, expect, it } from "vitest";

import { guessCSVMapping, parseCSVHeader, validateCSVMapping } from "./csv-mapping";

describe("CSV mapping", () => {
  it("reads quoted, escaped, and BOM-prefixed headers", () => {
    expect(parseCSVHeader('\uFEFFDate,"Narration, bank","Ref ""No""",Debit,Credit\r\n')).toEqual([
      "Date",
      "Narration, bank",
      'Ref "No"',
      "Debit",
      "Credit",
    ]);
  });

  it("guesses common Indian bank statement columns", () => {
    const mapping = guessCSVMapping(["Transaction Date", "Narration", "Cheque/Reference No", "Withdrawal Amount", "Deposit Amount", "Closing Balance"]);
    expect(mapping).toMatchObject({
      dateColumn: "Transaction Date",
      descriptionColumn: "Narration",
      referenceColumn: "Cheque/Reference No",
      debitColumn: "Withdrawal Amount",
      creditColumn: "Deposit Amount",
      balanceColumn: "Closing Balance",
    });
    expect(validateCSVMapping(mapping)).toBeNull();
  });
});
