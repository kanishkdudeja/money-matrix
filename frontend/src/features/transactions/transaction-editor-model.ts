import type { Account, Bucket, Category } from "../../api/queries";
import { parseDisplayAmount, sumAmounts, type MoneyAmount } from "../../lib/money";
import type { CreateTransaction } from "./mutations";

export type TransactionKind = CreateTransaction["kind"];

export interface EditorPosting {
  accountId: string;
  amount: string;
  memo: string;
}

export interface EditorBucketEntry {
  bucketId: string;
  categoryId: string;
  amount: string;
  memo: string;
}

export interface TransactionEditorValues {
  occurredOn: string;
  description: string;
  kind: TransactionKind;
  postings: EditorPosting[];
  bucketEntries: EditorBucketEntry[];
}

export interface EditorTotals {
  coverage: MoneyAmount;
  bucketTotal: MoneyAmount;
  difference: MoneyAmount;
  invalidAmounts: boolean;
}

const minInt64 = -9223372036854775808n;
const maxInt64 = 9223372036854775807n;

export const transactionKinds: { value: TransactionKind; label: string; hint: string }[] = [
  { value: "expense", label: "Expense", hint: "Money spent from an account or charged to debt" },
  { value: "income", label: "Income", hint: "New coverage received" },
  { value: "transfer", label: "Account transfer", hint: "Move money or pay down debt without changing coverage" },
  { value: "refund", label: "Refund", hint: "A genuine receipt returning earlier spending" },
  { value: "bucket_transfer", label: "Bucket transfer", hint: "Reassign purpose without moving real money" },
  { value: "opening_balance", label: "Opening balance", hint: "Establish the starting balance of an account" },
  { value: "adjustment", label: "Adjustment", hint: "An explicit correction or exceptional event" },
];

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function posting(accountId: string, amount: string): EditorPosting {
  return { accountId, amount, memo: "" };
}

function bucketEntry(bucketId: string, amount: string, categoryId = ""): EditorBucketEntry {
  return { bucketId, categoryId, amount, memo: "" };
}

function sourceAmount(account: Account | undefined): string {
  return account?.balanceClass === "liability" ? "100.00" : "-100.00";
}

function destinationAmount(account: Account | undefined): string {
  return account?.balanceClass === "liability" ? "-100.00" : "100.00";
}

export function presetValues(
  kind: TransactionKind,
  accounts: Account[],
  buckets: Bucket[],
  categories: Category[],
): TransactionEditorValues {
  const activeAccounts = accounts.filter((account) => !account.archived);
  const activeBuckets = buckets.filter((bucket) => !bucket.archived);
  const firstAccount = activeAccounts[0];
  const secondAccount = activeAccounts[1] ?? firstAccount;
  const firstBucket = activeBuckets[0];
  const secondBucket = activeBuckets[1] ?? firstBucket;
  const incomeCategory = categories.find((category) => !category.archived && category.kind === "income");
  const expenseCategory = categories.find((category) => !category.archived && category.kind === "expense");
  const base = { occurredOn: localDate(), description: "", kind, postings: [], bucketEntries: [] } satisfies TransactionEditorValues;

  switch (kind) {
    case "income":
      return { ...base, postings: [posting(firstAccount?.id ?? "", destinationAmount(firstAccount))], bucketEntries: [bucketEntry(firstBucket?.id ?? "", "100.00", incomeCategory?.id)] };
    case "expense":
      return { ...base, postings: [posting(firstAccount?.id ?? "", sourceAmount(firstAccount))], bucketEntries: [bucketEntry(firstBucket?.id ?? "", "-100.00", expenseCategory?.id)] };
    case "refund":
      return { ...base, postings: [posting(firstAccount?.id ?? "", destinationAmount(firstAccount))], bucketEntries: [bucketEntry(firstBucket?.id ?? "", "100.00", expenseCategory?.id)] };
    case "transfer":
      return { ...base, postings: [posting(firstAccount?.id ?? "", sourceAmount(firstAccount)), posting(secondAccount?.id ?? "", destinationAmount(secondAccount))] };
    case "bucket_transfer":
      return { ...base, bucketEntries: [bucketEntry(firstBucket?.id ?? "", "-100.00"), bucketEntry(secondBucket?.id ?? "", "100.00")] };
    case "opening_balance": {
      const amount = firstAccount?.balanceClass === "liability" ? "-100.00" : "100.00";
      return { ...base, postings: [posting(firstAccount?.id ?? "", "100.00")], bucketEntries: [bucketEntry(firstBucket?.id ?? "", amount)] };
    }
    case "adjustment":
      return { ...base, postings: [posting(firstAccount?.id ?? "", "100.00")], bucketEntries: [bucketEntry(firstBucket?.id ?? "", firstAccount?.balanceClass === "liability" ? "-100.00" : "100.00")] };
  }
}

function parseEditorAmount(value: string): MoneyAmount {
  const amount = parseDisplayAmount(value);
  const integer = BigInt(amount);
  if (integer < minInt64 || integer > maxInt64) throw new TypeError("Amount is outside the supported range.");
  if (integer === 0n) throw new TypeError("Amounts cannot be zero.");
  return amount;
}

export function editorTotals(values: TransactionEditorValues, accounts: Account[]): EditorTotals {
  try {
    const accountClasses = new Map(accounts.map((account) => [account.id, account.balanceClass]));
    const coverage = sumAmounts(values.postings.map((entry) => {
      const amount = parseEditorAmount(entry.amount);
      return accountClasses.get(entry.accountId) === "liability" ? (-BigInt(amount)).toString() : amount;
    }));
    const bucketTotal = sumAmounts(values.bucketEntries.map((entry) => parseEditorAmount(entry.amount)));
    return { coverage, bucketTotal, difference: (BigInt(coverage) - BigInt(bucketTotal)).toString(), invalidAmounts: false };
  } catch {
    return { coverage: "0", bucketTotal: "0", difference: "0", invalidAmounts: true };
  }
}

export function buildTransactionCommand(values: TransactionEditorValues, accounts: Account[], buckets: Bucket[], categories: Category[]): CreateTransaction {
  if (!values.occurredOn || !values.description.trim()) throw new TypeError("Date and description are required.");
  const activeAccounts = new Map(accounts.filter((account) => !account.archived).map((account) => [account.id, account]));
  const activeBuckets = new Set(buckets.filter((bucket) => !bucket.archived).map((bucket) => bucket.id));
  const activeCategories = new Set(categories.filter((category) => !category.archived).map((category) => category.id));

  const postings = values.postings.map((entry) => {
    if (!activeAccounts.has(entry.accountId)) throw new TypeError("Every posting needs an active account.");
    return { accountId: entry.accountId, amount: parseEditorAmount(entry.amount), memo: entry.memo.trim() || null };
  });
  const bucketEntries = values.bucketEntries.map((entry) => {
    if (!activeBuckets.has(entry.bucketId)) throw new TypeError("Every BucketEntry needs an active bucket.");
    if (entry.categoryId && !activeCategories.has(entry.categoryId)) throw new TypeError("Every selected category must be active.");
    return {
      bucketId: entry.bucketId,
      categoryId: entry.categoryId || null,
      amount: parseEditorAmount(entry.amount),
      memo: entry.memo.trim() || null,
    };
  });
  const totals = editorTotals(values, accounts);
  if (totals.invalidAmounts) throw new TypeError("Enter valid non-zero rupee amounts with at most two decimal places.");

  if (values.kind === "bucket_transfer") {
    if (postings.length !== 0 || bucketEntries.length < 2 || bucketEntries.some((entry) => entry.categoryId)) {
      throw new TypeError("A bucket transfer needs no postings or categories and at least two BucketEntries.");
    }
    if (new Set(bucketEntries.map((entry) => entry.bucketId)).size < 2 || totals.bucketTotal !== "0") {
      throw new TypeError("A bucket transfer needs two distinct buckets and entries totaling zero.");
    }
  } else {
    if (postings.length === 0) throw new TypeError("A financial transaction needs at least one posting.");
    if (bucketEntries.length > 0 && totals.difference !== "0") {
      throw new TypeError("BucketEntries must total the financial coverage change.");
    }
    if (values.kind === "transfer") {
      if (new Set(postings.map((entry) => entry.accountId)).size < 2) throw new TypeError("An account transfer needs at least two distinct accounts.");
      if (totals.coverage !== "0") throw new TypeError("An account transfer must not change financial coverage.");
    }
    if ((values.kind === "income" || values.kind === "refund") && BigInt(totals.coverage) <= 0n) throw new TypeError("Income and refunds must add financial coverage.");
    if (values.kind === "expense" && BigInt(totals.coverage) >= 0n) throw new TypeError("An expense must consume financial coverage.");
  }

  return { occurredOn: values.occurredOn, description: values.description.trim(), kind: values.kind, postings, bucketEntries };
}
