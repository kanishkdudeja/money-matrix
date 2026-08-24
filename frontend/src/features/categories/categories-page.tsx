import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import { useState } from "react";

import { categoriesQuery, type Category } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog } from "../../components/ui/dialog";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel, PanelHeader } from "../../components/ui/panel";
import { useSetCategoryArchived } from "../catalogs/mutations";
import { CategoryForm } from "./category-form";

function CategoryList({ items, allCategories, onChangeArchived, pending }: { items: Category[]; allCategories: Category[]; onChangeArchived: (category: Category) => void; pending: boolean }) {
  const names = new Map(allCategories.map((category) => [category.id, category.name]));
  if (items.length === 0) return <EmptyState title="Nothing here yet" description="Categories of this type will appear here." />;

  return (
    <div className="divide-y divide-line">
      {items.map((category) => (
        <article key={category.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-sm font-bold text-ink">{category.name}</h3>
            {category.parentId ? <p className="mt-1 text-xs text-ink-muted">Under {names.get(category.parentId) ?? "Unknown parent"}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {category.archived ? <Badge>Archived</Badge> : null}
            <ConfirmDialog
              trigger={<Button variant="ghost" className="size-9 px-0" aria-label={`${category.archived ? "Restore" : "Archive"} ${category.name}`}>{category.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}</Button>}
              title={`${category.archived ? "Restore" : "Archive"} ${category.name}?`}
              description={category.archived ? "The category will become available for new classifications again." : "Historical classifications stay visible, but new BucketEntries cannot use this category."}
              confirmLabel={category.archived ? "Restore category" : "Archive category"}
              pending={pending}
              onConfirm={() => onChangeArchived(category)}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

export function CategoriesPage() {
  const query = useQuery(categoriesQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const archiveMutation = useSetCategoryArchived();

  if (query.isPending) return <LoadingState label="Loading categories…" />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const income = query.data.filter((category) => category.kind === "income");
  const expenses = query.data.filter((category) => category.kind === "expense");

  return (
    <>
      <PageHeader
        eyebrow="Classification"
        title="How money is earned and spent"
        description="Categories explain the economic nature of activity. They are optional on BucketEntries and separate from the purpose of a bucket."
        action={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden="true" /> Add category</Button>}
      />
      {notice ? <p className="mb-5 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong" role="status">{notice}</p> : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHeader title="Income categories" action={<ArrowDownLeft className="size-5 text-primary" aria-hidden="true" />} />
          <CategoryList items={income} allCategories={query.data} onChangeArchived={(category) => archiveMutation.mutate({ id: category.id, archived: !category.archived }, { onSuccess: () => setNotice(`${category.name} ${category.archived ? "restored" : "archived"}.`) })} pending={archiveMutation.isPending} />
        </Panel>
        <Panel className="overflow-hidden">
          <PanelHeader title="Expense categories" action={<ArrowUpRight className="size-5 text-danger" aria-hidden="true" />} />
          <CategoryList items={expenses} allCategories={query.data} onChangeArchived={(category) => archiveMutation.mutate({ id: category.id, archived: !category.archived }, { onSuccess: () => setNotice(`${category.name} ${category.archived ? "restored" : "archived"}.`) })} pending={archiveMutation.isPending} />
        </Panel>
      </div>
      {archiveMutation.error ? <p className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{archiveMutation.error.message}</p> : null}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Create a category" description="Categories explain what income or spending was; they do not reserve money themselves.">
        <CategoryForm categories={query.data} onCreated={(name) => { setCreateOpen(false); setNotice(`Category “${name}” created.`); }} onCancel={() => setCreateOpen(false)} />
      </Dialog>
    </>
  );
}
