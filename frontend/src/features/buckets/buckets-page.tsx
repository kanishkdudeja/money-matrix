import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Boxes, LockKeyhole, Plus } from "lucide-react";
import { useState } from "react";

import { bucketsQuery } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog } from "../../components/ui/dialog";
import { Money } from "../../components/ui/money";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel } from "../../components/ui/panel";
import { useSetBucketArchived } from "../catalogs/mutations";
import { BucketForm } from "./bucket-form";

export function BucketsPage() {
  const query = useQuery(bucketsQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const archiveMutation = useSetBucketArchived();

  if (query.isPending) return <LoadingState label="Loading buckets…" />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const buckets = [...query.data].sort((left, right) => Number(right.system) - Number(left.system) || Number(left.archived) - Number(right.archived));

  return (
    <>
      <PageHeader
        eyebrow="Reserved money"
        title="What your money is for"
        description="Buckets reserve covered money for purposes such as rent, travel, emergencies, or anything else you want to protect."
        action={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden="true" /> Add bucket</Button>}
      />
      {notice ? <p className="mb-5 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong" role="status">{notice}</p> : null}
      {buckets.length === 0 ? (
        <Panel><EmptyState title="No buckets yet" description="Buckets will help you give covered money a purpose." /></Panel>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Buckets">
          {buckets.map((bucket) => (
            <Panel key={bucket.id} className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <span className="rounded-xl bg-primary-soft p-2.5 text-primary">
                  {bucket.system ? <LockKeyhole className="size-5" aria-hidden="true" /> : <Boxes className="size-5" aria-hidden="true" />}
                </span>
                <div className="flex gap-2">
                  {bucket.system ? <Badge tone="warning">System</Badge> : null}
                  {bucket.archived ? <Badge>Archived</Badge> : null}
                </div>
              </div>
              <h2 className="mt-5 font-bold text-ink">{bucket.name}</h2>
              <Money amount={bucket.balance} colorize className="mt-1 block text-2xl font-bold" />
              <p className="mt-3 min-h-10 text-xs leading-5 text-ink-muted">
                {bucket.note ?? (bucket.system ? "Coverage not yet assigned to another purpose." : "No note added.")}
              </p>
              {!bucket.system ? (
                <div className="mt-4 border-t border-line pt-4">
                  <ConfirmDialog
                    trigger={<Button variant="ghost" className="h-9 px-2 text-xs">{bucket.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />} {bucket.archived ? "Restore" : "Archive"}</Button>}
                    title={`${bucket.archived ? "Restore" : "Archive"} ${bucket.name}?`}
                    description={bucket.archived ? "The bucket will become available for new BucketEntries again." : "Its historical BucketEntries remain intact, but new transactions cannot reserve or spend from it."}
                    confirmLabel={bucket.archived ? "Restore bucket" : "Archive bucket"}
                    pending={archiveMutation.isPending}
                    onConfirm={() => archiveMutation.mutate({ id: bucket.id, archived: !bucket.archived }, { onSuccess: () => setNotice(`${bucket.name} ${bucket.archived ? "restored" : "archived"}.`) })}
                  />
                </div>
              ) : null}
            </Panel>
          ))}
        </section>
      )}
      {archiveMutation.error ? <p className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{archiveMutation.error.message}</p> : null}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Create a bucket" description="Buckets reserve covered money for a purpose without moving it between bank accounts.">
        <BucketForm onCreated={(name) => { setCreateOpen(false); setNotice(`Bucket “${name}” created.`); }} onCancel={() => setCreateOpen(false)} />
      </Dialog>
    </>
  );
}
