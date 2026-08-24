import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Equal, Link2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { accountsQuery, bucketsQuery, categoriesQuery, transactionQuery } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Money } from "../../components/ui/money";
import { ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel, PanelHeader } from "../../components/ui/panel";
import { statusTone } from "../../components/ui/status";
import { formatDate } from "../../lib/dates";
import { negateAmount, sumAmounts } from "../../lib/money";
import { humanize } from "../../lib/strings";
import { ReversalDialog } from "./reversal-dialog";

export function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [reversalOpen, setReversalOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const transaction = useQuery(transactionQuery(id ?? ""));
  const accounts = useQuery(accountsQuery);
  const buckets = useQuery(bucketsQuery);
  const categories = useQuery(categoriesQuery);
  const queries = [transaction, accounts, buckets, categories];

  if (queries.some((query) => query.isPending)) return <LoadingState label="Loading transaction…" />;
  const error = queries.find((query) => query.error)?.error;
  if (error) {
    return <ErrorState error={error} onRetry={() => void Promise.all(queries.map((query) => query.refetch()))} />;
  }
  if (!transaction.data || !accounts.data || !buckets.data || !categories.data) return <LoadingState label="Loading transaction…" />;

  const value = transaction.data;
  const accountNames = new Map(accounts.data.map((account) => [account.id, account.name]));
  const bucketNames = new Map(buckets.data.map((bucket) => [bucket.id, bucket.name]));
  const categoryNames = new Map(categories.data.map((category) => [category.id, category.name]));
  const postingTotal = sumAmounts(value.postings.map((posting) => posting.amount));
  const bucketTotal = sumAmounts(value.bucketEntries.map((entry) => entry.amount));
  const difference = sumAmounts([postingTotal, negateAmount(bucketTotal)]);

  return (
    <>
      <Link to="/transactions" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary-strong">
        <ArrowLeft className="size-4" aria-hidden="true" /> Transactions
      </Link>
      <PageHeader
        eyebrow={`${humanize(value.kind)} · ${formatDate(value.occurredOn)}`}
        title={value.description}
        description={`Recorded from ${humanize(value.origin)} activity. This view exposes the ledger detail behind the real-world event.`}
        action={<div className="flex items-center gap-3"><Badge tone={statusTone(value.status)}>{humanize(value.status)}</Badge>{value.status === "posted" ? <Button onClick={() => setReversalOpen(true)}><RotateCcw className="size-4" /> Reverse</Button> : null}</div>}
      />
      {(location.state as { notice?: string } | null)?.notice ? <p className="mb-6 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong" role="status">{(location.state as { notice: string }).notice}</p> : null}

      {value.reversalOfId ? (
        <Link
          to={`/transactions/${value.reversalOfId}`}
          className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-info-soft px-4 py-3 text-sm font-semibold text-ink"
        >
          <Link2 className="size-4 text-primary" aria-hidden="true" /> This transaction reverses an earlier transaction. View the original.
        </Link>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHeader title="Account postings" />
          {value.postings.length === 0 ? (
            <p className="px-6 py-8 text-sm text-ink-muted">This is a bucket-only movement with no financial-account effect.</p>
          ) : (
            <div className="divide-y divide-line">
              {value.postings.map((posting) => (
                <div key={posting.id} className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
                  <div>
                    <p className="text-sm font-bold">{accountNames.get(posting.accountId) ?? "Unknown account"}</p>
                    {posting.memo ? <p className="mt-1 text-xs text-ink-muted">{posting.memo}</p> : null}
                  </div>
                  <Money amount={posting.amount} colorize showPlus className="text-sm font-bold" />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="BucketEntries" />
          {value.bucketEntries.length === 0 ? (
            <p className="px-6 py-8 text-sm text-ink-muted">This event has no bucket effect.</p>
          ) : (
            <div className="divide-y divide-line">
              {value.bucketEntries.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
                  <div>
                    <p className="text-sm font-bold">{bucketNames.get(entry.bucketId) ?? "Unknown bucket"}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {entry.categoryId ? categoryNames.get(entry.categoryId) ?? "Unknown category" : "No category"}
                      {entry.memo ? ` · ${entry.memo}` : ""}
                    </p>
                  </div>
                  <Money amount={entry.amount} colorize showPlus className="text-sm font-bold" />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-6 p-5 sm:p-6">
        <div className="grid items-center gap-4 text-sm sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <div><p className="text-xs text-ink-muted">Posting total</p><Money amount={postingTotal} className="mt-1 block font-bold" /></div>
          <Equal className="hidden size-4 text-ink-muted sm:block" aria-hidden="true" />
          <div><p className="text-xs text-ink-muted">BucketEntry total</p><Money amount={bucketTotal} className="mt-1 block font-bold" /></div>
          <span className="hidden text-ink-muted sm:block">Difference</span>
          <Money amount={difference} colorize className="font-bold" />
        </div>
      </Panel>
      <ReversalDialog
        transactionId={value.id}
        transactionDescription={value.description}
        open={reversalOpen}
        onOpenChange={setReversalOpen}
        onReversed={(reversalId) => {
          setReversalOpen(false);
          void navigate(`/transactions/${reversalId}`, { replace: true, state: { notice: "Reversal created. The original transaction remains preserved in the audit trail." } });
        }}
      />
    </>
  );
}
