import { useQuery } from "@tanstack/react-query";
import { Boxes, CircleDollarSign, Landmark, Scale, TriangleAlert } from "lucide-react";
import { Link } from "react-router";

import { accountsQuery, bucketsQuery, dashboardQuery, transactionsQuery } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { MetricCard } from "../../components/ui/metric-card";
import { Money } from "../../components/ui/money";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel, PanelHeader } from "../../components/ui/panel";
import { TransactionRow } from "../transactions/transaction-row";

export function DashboardPage() {
  const dashboard = useQuery(dashboardQuery);
  const accounts = useQuery(accountsQuery);
  const buckets = useQuery(bucketsQuery);
  const transactions = useQuery(transactionsQuery(5, 0));
  const queries = [dashboard, accounts, buckets, transactions];
  const error = queries.find((query) => query.error)?.error;

  if (queries.some((query) => query.isPending)) return <LoadingState />;
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void Promise.all(queries.map((query) => query.refetch()));
        }}
      />
    );
  }
  if (!dashboard.data || !accounts.data || !buckets.data || !transactions.data) return <LoadingState />;

  const summary = dashboard.data;
  const unallocated = buckets.data.find((bucket) => bucket.system || bucket.name.toLowerCase() === "unallocated");

  return (
    <>
      <PageHeader
        eyebrow="Financial overview"
        title="Your money, mapped clearly."
        description="A single view of what your accounts cover, where that money is reserved, and what still needs your attention."
      />

      <section aria-label="Financial summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Assets" amount={summary.assets} hint="Total balance across asset accounts" icon={Landmark} />
        <MetricCard label="Liabilities" amount={summary.liabilities} hint="Total balance across liability accounts" icon={CircleDollarSign} />
        <MetricCard label="Net covered" amount={summary.netCovered} hint="Assets plus liabilities in the ledger" icon={Scale} />
        <MetricCard label="Reserved in buckets" amount={summary.bucketTotal} hint="Purpose assigned to covered money" icon={Boxes} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(19rem,0.8fr)]">
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader
            title="Recent transactions"
            action={<Link to="/transactions" className="text-xs font-bold text-primary hover:text-primary-strong">View all</Link>}
          />
          {transactions.data.length === 0 ? (
            <EmptyState title="No transactions yet" description="Your latest posted activity will appear here." />
          ) : (
            transactions.data.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} accounts={accounts.data} />
            ))
          )}
        </Panel>

        <div className="space-y-6">
          <Panel className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold">Coverage equation</p>
                <p className="mt-1 text-xs leading-5 text-ink-muted">Net covered money should always equal the total across buckets.</p>
              </div>
              <Badge tone={summary.balanced ? "positive" : "danger"}>{summary.balanced ? "Balanced" : "Needs attention"}</Badge>
            </div>
            <div className="mt-5 rounded-xl bg-canvas p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Difference</span>
                <Money amount={summary.difference} colorize className="font-bold" />
              </div>
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-warning-soft p-2.5 text-warning">
                <TriangleAlert className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-bold">Unallocated</p>
                <Money amount={unallocated?.balance ?? "0"} className="mt-0.5 block text-xl font-bold" />
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-ink-muted">Money covered by your accounts that has not been assigned a more specific purpose.</p>
            <div className="mt-4 border-t border-line pt-4 text-xs text-ink-muted">
              <span className="font-bold text-ink">{summary.importsNeedingReview}</span> imported transaction{summary.importsNeedingReview === 1 ? "" : "s"} awaiting review
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
