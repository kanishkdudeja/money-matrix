import { describe, expect, it } from "vitest";

import type { Account, Bucket, Category } from "../../api/queries";
import { buildTransactionCommand, editorTotals, presetValues } from "./transaction-editor-model";

const accounts: Account[] = [
  { id: "asset", name: "Bank", kind: "bank", balanceClass: "asset", currency: "INR", balance: "0", archived: false },
  { id: "liability", name: "Card", kind: "credit_card", balanceClass: "liability", currency: "INR", balance: "0", archived: false },
];

const buckets: Bucket[] = [
  { id: "unallocated", name: "Unallocated", balance: "0", archived: false, system: true },
  { id: "food", name: "Food", balance: "0", archived: false, system: false },
];

const categories: Category[] = [
  { id: "salary", name: "Salary", kind: "income", archived: false },
  { id: "groceries", name: "Groceries", kind: "expense", archived: false },
];

describe("transaction editor model", () => {
  it("creates a balanced asset expense preset", () => {
    const values = presetValues("expense", accounts, buckets, categories);
    expect(values.postings[0]?.amount).toBe("-100.00");
    expect(values.bucketEntries[0]?.amount).toBe("-100.00");
    expect(editorTotals(values, accounts)).toMatchObject({ coverage: "-10000", bucketTotal: "-10000", difference: "0" });

    values.description = "Groceries";
    expect(buildTransactionCommand(values, accounts, buckets, categories).postings?.[0]?.amount).toBe("-10000");
  });

  it("uses liability signs without changing the coverage invariant", () => {
    const expense = presetValues("expense", [accounts[1]!], buckets, categories);
    expect(expense.postings[0]?.amount).toBe("100.00");
    expect(editorTotals(expense, accounts).coverage).toBe("-10000");

    const income = presetValues("income", [accounts[1]!], buckets, categories);
    expect(income.postings[0]?.amount).toBe("-100.00");
    expect(editorTotals(income, accounts).coverage).toBe("10000");
  });

  it("builds an account transfer with zero coverage across balance classes", () => {
    const values = presetValues("transfer", accounts, buckets, categories);
    values.description = "Pay card";
    expect(editorTotals(values, accounts).coverage).toBe("0");
    expect(buildTransactionCommand(values, accounts, buckets, categories).bucketEntries).toEqual([]);

    values.postings[1]!.accountId = values.postings[0]!.accountId;
    values.postings[1]!.amount = "100.00";
    expect(() => buildTransactionCommand(values, accounts, buckets, categories)).toThrow(/distinct accounts/i);
  });

  it("accepts an omitted bucket breakdown for automatic Unallocated coverage", () => {
    const values = presetValues("income", accounts, buckets, categories);
    values.description = "Interest";
    values.bucketEntries = [];
    expect(buildTransactionCommand(values, accounts, buckets, categories).bucketEntries).toEqual([]);
  });

  it("rejects a mismatched financial and bucket split", () => {
    const values = presetValues("expense", accounts, buckets, categories);
    values.description = "Bad split";
    values.bucketEntries[0]!.amount = "-90.00";
    expect(() => buildTransactionCommand(values, accounts, buckets, categories)).toThrow(/must total/i);
  });

  it("requires distinct balanced buckets for a bucket transfer", () => {
    const values = presetValues("bucket_transfer", accounts, buckets, categories);
    values.description = "Reserve groceries";
    expect(buildTransactionCommand(values, accounts, buckets, categories).postings).toEqual([]);

    values.bucketEntries[1]!.bucketId = values.bucketEntries[0]!.bucketId;
    expect(() => buildTransactionCommand(values, accounts, buckets, categories)).toThrow(/distinct buckets/i);
  });

  it("rejects intent-sign errors and values outside signed bigint storage", () => {
    const income = presetValues("income", accounts, buckets, categories);
    income.description = "Incorrect income";
    income.postings[0]!.amount = "-100.00";
    income.bucketEntries[0]!.amount = "-100.00";
    expect(() => buildTransactionCommand(income, accounts, buckets, categories)).toThrow(/must add/i);

    income.postings[0]!.amount = "92233720368547758.08";
    expect(() => buildTransactionCommand(income, accounts, buckets, categories)).toThrow(/supported range/i);
  });
});
