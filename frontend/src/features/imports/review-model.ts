import type { components } from "../../api/generated";
import { parseDisplayAmount, sumAmounts, toDisplayAmount } from "../../lib/money";

export type ReviewEntryValue = {
  bucketId: string;
  categoryId: string;
  amount: string;
  memo: string;
};

export type ReviewValues = { bucketEntries: ReviewEntryValue[] };

export function initialReviewValues(amount: string, bucketId: string): ReviewValues {
  return { bucketEntries: [{ bucketId, categoryId: "", amount: toDisplayAmount(amount), memo: "" }] };
}

export function reviewTotal(values: ReviewValues): { amount: string; invalid: boolean } {
  try {
    return { amount: sumAmounts(values.bucketEntries.map((entry) => parseDisplayAmount(entry.amount))), invalid: false };
  } catch {
    return { amount: "0", invalid: true };
  }
}

export function buildCategorization(values: ReviewValues, expectedAmount: string): components["schemas"]["Categorization"] {
  if (values.bucketEntries.length === 0) throw new Error("Add at least one BucketEntry.");
  const bucketEntries = values.bucketEntries.map((entry) => {
    if (!entry.bucketId) throw new Error("Choose a bucket for every entry.");
    const amount = parseDisplayAmount(entry.amount);
    if (amount === "0") throw new Error("BucketEntry amounts cannot be zero.");
    return {
      bucketId: entry.bucketId,
      categoryId: entry.categoryId || null,
      amount,
      memo: entry.memo.trim() || null,
    };
  });
  if (sumAmounts(bucketEntries.map((entry) => entry.amount)) !== expectedAmount) {
    throw new Error("BucketEntry amounts must add up exactly to the imported amount.");
  }
  return { bucketEntries };
}
