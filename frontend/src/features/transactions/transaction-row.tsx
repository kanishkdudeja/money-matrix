import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import type { Account, Transaction } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Money } from "../../components/ui/money";
import { statusTone } from "../../components/ui/status";
import { formatDate } from "../../lib/dates";
import { sumAmounts } from "../../lib/money";

export function TransactionRow({ transaction, accounts }: { transaction: Transaction; accounts: Account[] }) {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const accountLabel = transaction.postings.map((posting) => accountNames.get(posting.accountId) ?? "Unknown account").join(" · ");
  const netAmount = sumAmounts(transaction.postings.map((posting) => posting.amount));
  const isTransfer = netAmount === "0" && transaction.postings.length > 1;

  return (
    <Link
      to={`/transactions/${transaction.id}`}
      className="group grid gap-3 border-b border-line px-5 py-4 transition-colors last:border-b-0 hover:bg-primary-soft/45 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto_auto] sm:items-center sm:px-6"
    >
      <time className="text-xs font-semibold text-ink-muted" dateTime={transaction.occurredOn}>
        {formatDate(transaction.occurredOn)}
      </time>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-ink">{transaction.description}</p>
        <p className="mt-1 truncate text-xs text-ink-muted">{accountLabel || "Bucket-only movement"}</p>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <Badge tone={statusTone(transaction.status)}>{transaction.status.replaceAll("_", " ")}</Badge>
        <Badge>{transaction.kind.replaceAll("_", " ")}</Badge>
      </div>
      <div className="flex min-w-32 items-center justify-between gap-3 sm:justify-end">
        {isTransfer ? (
          <span className="text-sm font-semibold text-ink-muted">Transfer</span>
        ) : (
          <Money amount={netAmount} colorize showPlus className="text-sm font-bold" />
        )}
        <ChevronRight className="size-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Link>
  );
}
