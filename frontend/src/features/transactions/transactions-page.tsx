import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { accountsQuery, transactionsQuery } from "../../api/queries";
import { Button } from "../../components/ui/button";
import { buttonStyles } from "../../components/ui/button-styles";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel } from "../../components/ui/panel";
import { TransactionRow } from "./transaction-row";

const pageSize = 25;

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const transactions = useQuery(transactionsQuery(pageSize, (page - 1) * pageSize));
  const accounts = useQuery(accountsQuery);

  if (transactions.isPending || accounts.isPending) return <LoadingState label="Loading transactions…" />;
  const error = transactions.error ?? accounts.error;
  if (error) {
    return <ErrorState error={error} onRetry={() => void Promise.all([transactions.refetch(), accounts.refetch()])} />;
  }
  if (!transactions.data || !accounts.data) return <LoadingState label="Loading transactions…" />;

  const goToPage = (nextPage: number) => {
    if (nextPage === 1) setSearchParams({});
    else setSearchParams({ page: String(nextPage) });
  };

  return (
    <>
      <PageHeader
        eyebrow="Ledger timeline"
        title="Transactions"
        description="Real-world events, shown with their account effects and purpose splits. Open any row to inspect the underlying postings and BucketEntries."
        action={<div className="flex gap-2"><a href="/api/export/transactions.csv" download className={buttonStyles()}><Download className="size-4" /> Export CSV</a><Link to="/transactions/new" className={buttonStyles("primary")}><Plus className="size-4" /> Add transaction</Link></div>}
      />
      <Panel className="overflow-hidden">
        {transactions.data.length === 0 ? (
          <EmptyState
            title={page === 1 ? "No transactions yet" : "No more transactions"}
            description={page === 1 ? "Posted transactions will build your financial timeline here." : "Return to the previous page to keep browsing."}
          />
        ) : (
          transactions.data.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} accounts={accounts.data} />
          ))
        )}
      </Panel>
      <div className="mt-5 flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-muted">Page {page}</p>
        <div className="flex gap-2">
          <Button disabled={page === 1} onClick={() => goToPage(page - 1)}>
            <ChevronLeft className="size-4" aria-hidden="true" /> Previous
          </Button>
          <Button disabled={transactions.data.length < pageSize} onClick={() => goToPage(page + 1)}>
            Next <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </>
  );
}
