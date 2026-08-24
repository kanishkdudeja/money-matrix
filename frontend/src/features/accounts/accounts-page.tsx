import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, CreditCard, Landmark, PiggyBank, Plus, WalletCards } from "lucide-react";
import { useState } from "react";

import { accountsQuery } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog } from "../../components/ui/dialog";
import { Money } from "../../components/ui/money";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel } from "../../components/ui/panel";
import { humanize } from "../../lib/strings";
import { useSetAccountArchived } from "../catalogs/mutations";
import { AccountForm } from "./account-form";

const accountIcons = {
  bank: Landmark,
  cash: WalletCards,
  credit_card: CreditCard,
  loan: CreditCard,
  investment: PiggyBank,
  other: WalletCards,
} as const;

export function AccountsPage() {
  const query = useQuery(accountsQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const archiveMutation = useSetAccountArchived();

  if (query.isPending) return <LoadingState label="Loading accounts…" />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const accounts = [...query.data].sort((left, right) => Number(left.archived) - Number(right.archived));

  return (
    <>
      <PageHeader
        eyebrow="Financial accounts"
        title="Where money actually lives"
        description="Banks, cash, cards, loans, and investments. Balances come from immutable ledger postings—not editable counters."
        action={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden="true" /> Add account</Button>}
      />
      {notice ? <p className="mb-5 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong" role="status">{notice}</p> : null}
      <Panel className="overflow-hidden">
        {accounts.length === 0 ? (
          <EmptyState title="No accounts yet" description="Create your first financial account to begin recording real-world activity." />
        ) : (
          <div className="divide-y divide-line">
            {accounts.map((account) => {
              const Icon = accountIcons[account.kind];
              return (
                <article key={account.id} className="grid gap-4 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center sm:px-6">
                  <span className="hidden rounded-xl bg-primary-soft p-3 text-primary sm:inline-flex">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-bold text-ink">{account.name}</h2>
                      {account.archived ? <Badge>Archived</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {humanize(account.kind)} · {humanize(account.balanceClass)} · {account.currency}
                    </p>
                    {account.note ? <p className="mt-2 text-sm text-ink-muted">{account.note}</p> : null}
                  </div>
                  <Money amount={account.balance} colorize className="text-lg font-bold" />
                  <ConfirmDialog
                    trigger={<Button variant="ghost" className="size-10 px-0" aria-label={`${account.archived ? "Restore" : "Archive"} ${account.name}`}>{account.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}</Button>}
                    title={`${account.archived ? "Restore" : "Archive"} ${account.name}?`}
                    description={account.archived ? "The account will become available for new transactions again." : "Historical activity remains intact, but new transactions cannot use this account."}
                    confirmLabel={account.archived ? "Restore account" : "Archive account"}
                    pending={archiveMutation.isPending}
                    onConfirm={() => archiveMutation.mutate({ id: account.id, archived: !account.archived }, { onSuccess: () => setNotice(`${account.name} ${account.archived ? "restored" : "archived"}.`) })}
                  />
                </article>
              );
            })}
          </div>
        )}
      </Panel>
      {archiveMutation.error ? <p className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{archiveMutation.error.message}</p> : null}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Add financial account" description="Create the real account first. Its opening balance should be recorded as a separate auditable transaction.">
        <AccountForm onCreated={(name) => { setCreateOpen(false); setNotice(`Account “${name}” created.`); }} onCancel={() => setCreateOpen(false)} />
      </Dialog>
    </>
  );
}
