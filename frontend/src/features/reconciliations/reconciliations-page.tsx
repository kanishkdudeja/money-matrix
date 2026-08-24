import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Plus, RotateCcw, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { accountsQuery, reconciliationsQuery, type Account, type Reconciliation } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog } from "../../components/ui/dialog";
import { FieldError, Input, Label, Select } from "../../components/ui/form";
import { Money } from "../../components/ui/money";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel } from "../../components/ui/panel";
import { statusTone } from "../../components/ui/status";
import { formatDate, formatDateTime } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { humanize } from "../../lib/strings";
import { useCompleteReconciliation, useCreateReconciliation, useDiscardReconciliation, useReopenReconciliation } from "./mutations";
import { buildReconciliationCommand, canReopenReconciliation, latestCompletedForAccount, reconciliationDifference, todayForInput, type ReconciliationFormValues } from "./reconciliation-model";

export function ReconciliationsPage() {
  const reconciliations = useQuery(reconciliationsQuery);
  const accounts = useQuery(accountsQuery);
  const [createOpen, setCreateOpen] = useState(false);

  if (reconciliations.isPending || accounts.isPending) return <LoadingState label="Loading reconciliations…" />;
  const error = reconciliations.error ?? accounts.error;
  if (error) return <ErrorState error={error} onRetry={() => void Promise.all([reconciliations.refetch(), accounts.refetch()])} />;
  if (!reconciliations.data || !accounts.data) return <LoadingState label="Loading reconciliations…" />;

  return <LoadedReconciliations reconciliations={reconciliations.data} accounts={accounts.data} createOpen={createOpen} setCreateOpen={setCreateOpen} />;
}

function LoadedReconciliations({ reconciliations, accounts, createOpen, setCreateOpen }: { reconciliations: Reconciliation[]; accounts: Account[]; createOpen: boolean; setCreateOpen: (open: boolean) => void }) {
  const complete = useCompleteReconciliation();
  const reopen = useReopenReconciliation();
  const discard = useDiscardReconciliation();
  const [notice, setNotice] = useState<string | null>(null);
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const actionError = complete.error ?? reopen.error ?? discard.error;
  const actionPending = complete.isPending || reopen.isPending || discard.isPending;

  return (
    <>
      <PageHeader
        eyebrow="Verified checkpoints"
        title="Reconciliations"
        description="Compare Money Matrix with a statement balance at a point in time, then lock that verified period against accidental changes."
        action={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New reconciliation</Button>}
      />

      <div className="mb-6 rounded-2xl border border-line bg-info-soft px-5 py-4 text-sm leading-6 text-ink-muted">
        <strong className="text-ink">How it works:</strong> create a draft from a real statement, resolve any difference by correcting missing or incorrect transactions, then complete it. For credit cards and loans, enter the positive amount owed shown on the statement.
      </div>

      {notice ? <p className="mb-5 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong" role="status">{notice}</p> : null}
      {actionError ? <p className="mb-5 rounded-xl bg-danger-soft p-4 text-sm text-danger" role="alert">{friendlyActionError(actionError)}</p> : null}

      <Panel className="overflow-hidden">
        {reconciliations.length === 0 ? (
          <EmptyState title="No reconciliations yet" description="Create a checkpoint from an account statement to compare and verify the ledger." />
        ) : (
          <div className="divide-y divide-line">
            {reconciliations.map((item) => {
              const difference = reconciliationDifference(item);
              const isOpen = item.status === "in_progress" || item.status === "reopened";
              const canReopen = canReopenReconciliation(item, reconciliations);
              return (
                <article key={item.id} className="px-5 py-5 sm:px-6">
                  <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)_minmax(26rem,auto)] lg:items-center">
                    <span className="hidden rounded-xl bg-primary-soft p-3 text-primary lg:inline-flex"><Scale className="size-5" aria-hidden="true" /></span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold">{accountNames.get(item.financialAccountId) ?? "Unknown account"}</h2>
                        <Badge tone={statusTone(item.status)}>{humanize(item.status)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">Statement date {formatDate(item.statementDate)}{item.completedAt ? ` · Completed ${formatDateTime(item.completedAt)}` : ""}</p>
                    </div>
                    <dl className="grid grid-cols-3 gap-3 rounded-xl bg-canvas p-3 text-right">
                      <BalanceMetric label="Computed" amount={item.computedBalance} />
                      <BalanceMetric label="Statement" amount={item.statementBalance} />
                      <BalanceMetric label="Difference" amount={item.difference} colorize />
                    </dl>
                  </div>

                  {isOpen ? (
                    <div className={`mt-4 flex flex-col justify-between gap-4 rounded-xl px-4 py-3 sm:flex-row sm:items-center ${difference.direction === "balanced" ? "bg-primary-soft" : "bg-warning-soft"}`}>
                      <p className={`text-sm ${difference.direction === "balanced" ? "text-primary-strong" : "text-warning"}`}>
                        {difference.direction === "balanced"
                          ? "The ledger agrees with the statement. This checkpoint is ready to complete."
                          : <>Money Matrix is {difference.direction} than the statement by <Money amount={difference.absolute} className="font-bold" />. Review transactions dated on or before the statement date.</>}
                      </p>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {item.status === "in_progress" ? (
                          <ConfirmDialog
                            trigger={<Button className="text-danger" disabled={actionPending}><Trash2 className="size-4" /> Discard draft</Button>}
                            title="Discard this reconciliation draft?"
                            description="This removes only the draft checkpoint. It does not change transactions or account balances."
                            confirmLabel="Discard draft"
                            pending={discard.isPending}
                            onConfirm={() => discard.mutate(item.id, { onSuccess: () => setNotice("Reconciliation draft discarded. Transactions and balances were unchanged.") })}
                          />
                        ) : null}
                        <ConfirmDialog
                          trigger={<Button variant="primary" disabled={actionPending || difference.direction !== "balanced"}><CheckCircle2 className="size-4" /> Complete</Button>}
                          title="Complete this reconciliation?"
                          description={`This verifies ${accountNames.get(item.financialAccountId) ?? "the account"} through ${formatDate(item.statementDate)} and protects that period from later financial changes.`}
                          confirmLabel="Complete checkpoint"
                          pending={complete.isPending}
                          onConfirm={() => complete.mutate(item.id, { onSuccess: () => setNotice(`Reconciliation completed through ${formatDate(item.statementDate)}.`) })}
                        />
                      </div>
                    </div>
                  ) : canReopen ? (
                    <div className="mt-4 flex flex-col justify-between gap-3 rounded-xl bg-canvas px-4 py-3 sm:flex-row sm:items-center">
                      <p className="text-xs leading-5 text-ink-muted">This is the latest completed checkpoint for the account. Reopen it only to correct the protected period.</p>
                      <ConfirmDialog
                        trigger={<Button disabled={actionPending}><RotateCcw className="size-4" /> Reopen</Button>}
                        title="Reopen this verified period?"
                        description="Transactions through this statement date will become editable again. After corrections, the checkpoint must balance before it can be completed again."
                        confirmLabel="Reopen checkpoint"
                        pending={reopen.isPending}
                        onConfirm={() => reopen.mutate(item.id, { onSuccess: () => setNotice(`Reconciliation reopened through ${formatDate(item.statementDate)}.`) })}
                      />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="New reconciliation" description="Use the ending balance and date printed on the statement. Money Matrix will create a draft and calculate the difference.">
        <CreateReconciliationForm accounts={accounts} reconciliations={reconciliations} onCreated={() => { setCreateOpen(false); setNotice("Reconciliation draft created. Review the computed difference before completing it."); }} onCancel={() => setCreateOpen(false)} />
      </Dialog>
    </>
  );
}

function CreateReconciliationForm({ accounts, reconciliations, onCreated, onCancel }: { accounts: Account[]; reconciliations: Reconciliation[]; onCreated: () => void; onCancel: () => void }) {
  const eligibleAccounts = useMemo(() => accounts.filter((account) => !account.archived && !reconciliations.some((item) => item.financialAccountId === account.id && item.status !== "completed")), [accounts, reconciliations]);
  const mutation = useCreateReconciliation();
  const form = useForm<ReconciliationFormValues>({ defaultValues: { financialAccountId: eligibleAccounts[0]?.id ?? "", statementDate: todayForInput(), statementBalance: "0.00" } });
  const selectedAccountId = useWatch({ control: form.control, name: "financialAccountId" });
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const latest = latestCompletedForAccount(selectedAccountId, reconciliations);

  if (eligibleAccounts.length === 0) {
    return <div><p className="rounded-xl bg-warning-soft p-4 text-sm leading-6 text-warning">Every active account already has an open reconciliation, or there are no active accounts. Finish or discard the existing draft first.</p><div className="mt-5 flex justify-end"><Button onClick={onCancel}>Close</Button></div></div>;
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit((values) => {
      form.clearErrors();
      try {
        mutation.mutate(buildReconciliationCommand(values, reconciliations), { onSuccess: onCreated });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The reconciliation is invalid.";
        const field = message.includes("account") ? "financialAccountId" : message.includes("date") ? "statementDate" : "statementBalance";
        form.setError(field, { message }, { shouldFocus: true });
      }
    })(event)} className="space-y-5">
      <div>
        <Label htmlFor="reconciliation-account">Financial account</Label>
        <Select id="reconciliation-account" {...form.register("financialAccountId")}>
          {eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · current balance {formatMoney(account.balance)}</option>)}
        </Select>
        <FieldError>{form.formState.errors.financialAccountId?.message}</FieldError>
        {selectedAccount ? <p className="mt-2 text-xs leading-5 text-ink-muted">{selectedAccount.balanceClass === "liability" ? "Enter the positive amount owed on the statement." : "Enter the statement’s ending account balance."} The current balance shown above may include activity after the statement date.</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="reconciliation-date">Statement ending date</Label><Input id="reconciliation-date" type="date" {...form.register("statementDate", { required: "Statement date is required." })} /><FieldError>{form.formState.errors.statementDate?.message}</FieldError>{latest ? <p className="mt-2 text-xs text-ink-muted">Must be after {formatDate(latest.statementDate)}.</p> : null}</div>
        <div><Label htmlFor="reconciliation-balance">Ending balance (₹)</Label><Input id="reconciliation-balance" inputMode="decimal" {...form.register("statementBalance", { required: "Ending balance is required." })} /><FieldError>{form.formState.errors.statementBalance?.message}</FieldError></div>
      </div>
      <div className="rounded-xl bg-info-soft p-4 text-xs leading-5 text-ink-muted">Creating this draft does not lock anything yet. The verified-period protection starts only after the difference reaches zero and you explicitly complete it.</div>
      {mutation.error ? <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{friendlyActionError(mutation.error)}</p> : null}
      <div className="flex justify-end gap-3"><Button onClick={onCancel} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Calculating…" : "Create draft"}</Button></div>
    </form>
  );
}

function BalanceMetric({ label, amount, colorize = false }: { label: string; amount: string; colorize?: boolean }) {
  return <div><dt className="text-[0.7rem] text-ink-muted">{label}</dt><dd className="mt-1 text-sm font-bold"><Money amount={amount} colorize={colorize} /></dd></div>;
}

function friendlyActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The reconciliation action could not be completed.";
  if (message.includes("open reconciliation")) return "This account already has an open reconciliation. Finish or discard it before starting another.";
  if (message.includes("only the latest")) return "Only the latest completed checkpoint for an account can be reopened.";
  if (message.includes("does not balance")) return "The ledger changed and no longer matches the statement. Refresh the checkpoint and resolve the difference before completing it.";
  return message;
}
