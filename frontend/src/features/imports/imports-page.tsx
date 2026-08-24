import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { accountsQuery, importsQuery, type ImportStatus } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { buttonStyles } from "../../components/ui/button-styles";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel } from "../../components/ui/panel";
import { statusTone } from "../../components/ui/status";
import { formatDateTime } from "../../lib/dates";
import { humanize } from "../../lib/strings";

export function ImportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStatus = searchParams.get("status");
  const status = importStatuses.includes(requestedStatus as ImportStatus) ? requestedStatus as ImportStatus : undefined;
  const imports = useQuery(importsQuery(status));
  const accounts = useQuery(accountsQuery);

  if (imports.isPending || accounts.isPending) return <LoadingState label="Loading statement imports…" />;
  const error = imports.error ?? accounts.error;
  if (error) return <ErrorState error={error} onRetry={() => void Promise.all([imports.refetch(), accounts.refetch()])} />;
  if (!imports.data || !accounts.data) return <LoadingState label="Loading statement imports…" />;

  const accountNames = new Map(accounts.data.map((account) => [account.id, account.name]));

  return (
    <>
      <PageHeader
        eyebrow="Statement inbox"
        title="Imports"
        description="Uploaded bank rows remain discoverable here while they move through parsing, duplicate detection, and categorization review."
        action={<Link to="/imports/new" className={buttonStyles("primary")}>Upload statement</Link>}
      />
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter imports">
        <button type="button" onClick={() => setSearchParams({})} className={buttonStyles(status ? "secondary" : "primary", "h-9 px-3 text-xs")}>All</button>
        {importStatuses.map((value) => <button key={value} type="button" onClick={() => setSearchParams({ status: value })} className={buttonStyles(status === value ? "primary" : "secondary", "h-9 px-3 text-xs")}>{humanize(value)}</button>)}
      </div>
      <Panel className="overflow-hidden">
        {imports.data.length === 0 ? (
          <EmptyState title="No statement imports" description="CSV uploads and their review progress will appear in this inbox." />
        ) : (
          <div className="divide-y divide-line">
            {imports.data.map((batch) => (
              <Link to={`/imports/${batch.id}`} key={batch.id} className="grid gap-4 px-5 py-5 transition hover:bg-canvas sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-6">
                <span className="hidden rounded-xl bg-primary-soft p-3 text-primary sm:inline-flex"><FileSpreadsheet className="size-5" aria-hidden="true" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-bold">{batch.fileName}</h2>
                    <Badge tone={statusTone(batch.status)}>{humanize(batch.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{accountNames.get(batch.accountId) ?? "Unknown account"} · {formatDateTime(batch.createdAt)}</p>
                </div>
                <dl className="grid grid-cols-4 gap-4 text-center text-xs">
                  <div><dt className="text-ink-muted">Imported</dt><dd className="mt-1 font-bold">{batch.imported}</dd></div>
                  <div><dt className="text-ink-muted">Pending</dt><dd className="mt-1 font-bold text-warning">{batch.pending}</dd></div>
                  <div><dt className="text-ink-muted">Duplicate</dt><dd className="mt-1 font-bold">{batch.duplicates}</dd></div>
                  <div><dt className="text-ink-muted">Invalid</dt><dd className="mt-1 font-bold text-danger">{batch.invalid}</dd></div>
                </dl>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

const importStatuses: ImportStatus[] = ["ready", "processing", "uploaded", "failed", "completed"];
