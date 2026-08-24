import { describe, expect, it } from "vitest";

import type { Reconciliation } from "../../api/queries";
import { buildReconciliationCommand, canReopenReconciliation, reconciliationDifference, todayForInput } from "./reconciliation-model";

const completed = (id: string, date: string): Reconciliation => ({
  id,
  financialAccountId: "account-1",
  statementDate: date,
  statementBalance: "10000",
  computedBalance: "10000",
  difference: "0",
  status: "completed",
  completedAt: `${date}T12:00:00Z`,
});

describe("reconciliation model", () => {
  it("builds an exact minor-unit draft after the latest checkpoint", () => {
    expect(buildReconciliationCommand({ financialAccountId: "account-1", statementDate: "2026-09-30", statementBalance: "1,234.56" }, [completed("older", "2026-08-31")])).toEqual({
      financialAccountId: "account-1",
      statementDate: "2026-09-30",
      statementBalance: "123456",
      complete: false,
    });
  });

  it("rejects an out-of-order date and a second open checkpoint", () => {
    expect(() => buildReconciliationCommand({ financialAccountId: "account-1", statementDate: "2026-08-31", statementBalance: "100" }, [completed("latest", "2026-08-31")])).toThrow(/must be after/i);
    const open: Reconciliation = { ...completed("open", "2026-09-30"), status: "in_progress", completedAt: null };
    expect(() => buildReconciliationCommand({ financialAccountId: "account-1", statementDate: "2026-10-31", statementBalance: "100" }, [open])).toThrow(/already has an open/i);
  });

  it("allows reopening only the latest completion when no checkpoint is open", () => {
    const older = completed("older", "2026-07-31");
    const latest = completed("latest", "2026-08-31");
    expect(canReopenReconciliation(older, [latest, older])).toBe(false);
    expect(canReopenReconciliation(latest, [latest, older])).toBe(true);
    expect(canReopenReconciliation(latest, [{ ...latest, status: "reopened", completedAt: null }, older])).toBe(false);
  });

  it("describes both signs of a difference without losing precision", () => {
    expect(reconciliationDifference({ ...completed("one", "2026-08-31"), difference: "-250" })).toEqual({ direction: "lower", absolute: "250" });
    expect(reconciliationDifference({ ...completed("two", "2026-08-31"), difference: "250" })).toEqual({ direction: "higher", absolute: "250" });
  });

  it("formats a local calendar date for the form", () => {
    expect(todayForInput(new Date(2026, 7, 3, 23, 30))).toBe("2026-08-03");
  });
});
