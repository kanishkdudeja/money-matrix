import type { components } from "../../api/generated";
import type { Reconciliation } from "../../api/queries";
import { compareAmounts, negateAmount, parseDisplayAmount } from "../../lib/money";

export type ReconciliationFormValues = {
  financialAccountId: string;
  statementDate: string;
  statementBalance: string;
};

export function buildReconciliationCommand(values: ReconciliationFormValues, reconciliations: Reconciliation[]): components["schemas"]["CreateReconciliation"] {
  if (!values.financialAccountId) throw new Error("Choose a financial account.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.statementDate)) throw new Error("Choose a valid statement date.");
  if (reconciliations.some((item) => item.financialAccountId === values.financialAccountId && item.status !== "completed")) {
    throw new Error("This account already has an open reconciliation.");
  }
  const latest = latestCompletedForAccount(values.financialAccountId, reconciliations);
  if (latest && values.statementDate <= latest.statementDate) {
    throw new Error(`The statement date must be after ${latest.statementDate}.`);
  }
  return {
    financialAccountId: values.financialAccountId,
    statementDate: values.statementDate,
    statementBalance: parseDisplayAmount(values.statementBalance),
    complete: false,
  };
}

export function latestCompletedForAccount(accountId: string, reconciliations: Reconciliation[]): Reconciliation | undefined {
  return reconciliations
    .filter((item) => item.financialAccountId === accountId && item.status === "completed")
    .sort((left, right) => right.statementDate.localeCompare(left.statementDate))[0];
}

export function canReopenReconciliation(item: Reconciliation, reconciliations: Reconciliation[]): boolean {
  if (item.status !== "completed") return false;
  if (reconciliations.some((candidate) => candidate.financialAccountId === item.financialAccountId && candidate.status !== "completed")) return false;
  return latestCompletedForAccount(item.financialAccountId, reconciliations)?.id === item.id;
}

export function reconciliationDifference(item: Reconciliation): { direction: "balanced" | "higher" | "lower"; absolute: string } {
  const comparison = compareAmounts(item.difference, "0");
  if (comparison === 0) return { direction: "balanced", absolute: "0" };
  return { direction: comparison > 0 ? "higher" : "lower", absolute: comparison > 0 ? item.difference : negateAmount(item.difference) };
}

export function todayForInput(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
