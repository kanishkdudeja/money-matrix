import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Lightbulb, Plus, SkipForward, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Link, useParams, useSearchParams } from "react-router";

import { accountsQuery, bucketsQuery, categoriesQuery, importBatchQuery, suggestionsQuery, type Bucket, type Category, type ImportedRow, type Suggestion } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Input, Label, Select } from "../../components/ui/form";
import { Money } from "../../components/ui/money";
import { ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel, PanelHeader } from "../../components/ui/panel";
import { statusTone } from "../../components/ui/status";
import { formatDate, formatDateTime } from "../../lib/dates";
import { humanize } from "../../lib/strings";
import { buildCategorization, initialReviewValues, reviewTotal, type ReviewValues } from "./review-model";
import { useCategorizeImportedRow, useSkipImportedRow } from "./mutations";

const actionableStatuses = new Set(["pending", "suggested"]);

export function ImportBatchPage() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const batch = useQuery(importBatchQuery(id));
  const accounts = useQuery(accountsQuery);
  const buckets = useQuery(bucketsQuery);
  const categories = useQuery(categoriesQuery);
  const [notice, setNotice] = useState<string | null>(null);
  const queries = [batch, accounts, buckets, categories];

  const selectedId = searchParams.get("row");
  const defaultRow = batch.data?.rows.find((row) => actionableStatuses.has(row.reviewStatus)) ?? batch.data?.rows[0];
  const selectedRow = batch.data?.rows.find((row) => row.id === selectedId) ?? defaultRow;

  useEffect(() => {
    if (!selectedId && defaultRow) setSearchParams({ row: defaultRow.id }, { replace: true });
  }, [defaultRow, selectedId, setSearchParams]);

  useEffect(() => {
    const rows = batch.data?.rows ?? [];
    if (rows.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("input, select, textarea, [contenteditable='true']")) return;
      const direction = event.key.toLowerCase() === "j" ? 1 : event.key.toLowerCase() === "k" ? -1 : 0;
      if (direction === 0) return;
      event.preventDefault();
      const currentIndex = Math.max(0, rows.findIndex((row) => row.id === selectedRow?.id));
      const nextIndex = (currentIndex + direction + rows.length) % rows.length;
      const nextRow = rows[nextIndex];
      if (nextRow) setSearchParams({ row: nextRow.id });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [batch.data?.rows, selectedRow?.id, setSearchParams]);

  if (queries.some((query) => query.isPending)) return <LoadingState label="Loading statement review…" />;
  const queryError = queries.find((query) => query.error)?.error;
  if (queryError) return <ErrorState error={queryError} onRetry={() => void Promise.all(queries.map((query) => query.refetch()))} />;
  if (!batch.data || !accounts.data || !buckets.data || !categories.data) return <LoadingState label="Loading statement review…" />;

  const account = accounts.data.find((candidate) => candidate.id === batch.data.accountId);
  const resolveRow = (currentId: string, message: string) => {
    const actionable = batch.data.rows.filter((row) => actionableStatuses.has(row.reviewStatus) && row.id !== currentId);
    if (actionable[0]) {
      setSearchParams({ row: actionable[0].id }, { replace: true });
      setNotice(`${message} Moved to the next row needing review.`);
    } else {
      setNotice(`${message} No actionable rows remain in this batch.`);
    }
  };

  return (
    <>
      <Link to="/imports" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary-strong"><ArrowLeft className="size-4" /> Imports</Link>
      <PageHeader
        eyebrow="Statement review"
        title={batch.data.fileName}
        description={`${account?.name ?? "Unknown account"} · uploaded ${formatDateTime(batch.data.createdAt)}. Imported amounts use money-in/money-out perspective.`}
        action={<div className="flex flex-col items-end gap-2"><Badge tone={statusTone(batch.data.status)}>{humanize(batch.data.status)}</Badge><span className="text-xs text-ink-muted"><kbd className="font-bold text-ink">J</kbd>/<kbd className="font-bold text-ink">K</kbd> rows · <kbd className="font-bold text-ink">Ctrl/⌘ Enter</kbd> save</span></div>}
      />

      {notice ? <p className="mb-5 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong" role="status">{notice}</p> : null}

      {batch.data.rows.length === 0 ? <Panel className="p-8 text-center text-sm text-ink-muted">This batch contains no rows.</Panel> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
          <Panel className="h-fit overflow-hidden">
            <PanelHeader title={`${batch.data.rows.length} statement rows`} />
            <div className="max-h-[68vh] divide-y divide-line overflow-y-auto">
              {batch.data.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSearchParams({ row: row.id })}
                  className={`w-full px-5 py-4 text-left transition ${selectedRow?.id === row.id ? "bg-primary-soft" : "hover:bg-canvas"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm font-bold text-ink">{row.description ?? `CSV row ${row.sourceRow}`}</p><p className="mt-1 text-xs text-ink-muted">{row.transactionDate ? formatDate(row.transactionDate) : `Source row ${row.sourceRow}`}</p></div>
                    {row.amount ? <Money amount={row.amount} colorize showPlus className="text-sm font-bold" /> : null}
                  </div>
                  <Badge tone={statusTone(row.reviewStatus)}>{humanize(row.reviewStatus)}</Badge>
                </button>
              ))}
            </div>
          </Panel>

          {selectedRow ? (
            <ReviewPane
              key={selectedRow.id}
              batchId={batch.data.id}
              row={selectedRow}
              buckets={buckets.data}
              categories={categories.data}
              onResolved={(message) => resolveRow(selectedRow.id, message)}
            />
          ) : null}
        </div>
      )}
    </>
  );
}

function ReviewPane({ batchId, row, buckets, categories, onResolved }: { batchId: string; row: ImportedRow; buckets: Bucket[]; categories: Category[]; onResolved: (message: string) => void }) {
  const actionable = actionableStatuses.has(row.reviewStatus) && row.amount != null;
  const suggestions = useQuery({ ...suggestionsQuery(row.id), enabled: actionable });
  const activeBuckets = useMemo(() => buckets.filter((bucket) => !bucket.archived), [buckets]);
  const activeCategories = useMemo(() => categories.filter((category) => !category.archived), [categories]);
  const unallocated = activeBuckets.find((bucket) => bucket.system) ?? activeBuckets[0];

  return (
    <Panel className="h-fit overflow-hidden">
      <div className="border-b border-line p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><Badge tone={statusTone(row.reviewStatus)}>{humanize(row.reviewStatus)}</Badge><h2 className="mt-3 font-display text-2xl font-semibold text-ink">{row.description ?? `CSV row ${row.sourceRow}`}</h2></div>
          {row.amount ? <Money amount={row.amount} colorize showPlus className="text-2xl font-bold" /> : null}
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <Evidence label="Date" value={row.transactionDate ? formatDate(row.transactionDate) : "Not parsed"} />
          <Evidence label="Source row" value={String(row.sourceRow)} />
          <Evidence label="Reference" value={row.reference || "—"} />
          <Evidence label="Statement balance" value={row.balance ? undefined : "—"}>{row.balance ? <Money amount={row.balance} /> : null}</Evidence>
        </dl>
        {row.parseErrors.length > 0 ? <ul className="mt-5 rounded-xl bg-danger-soft p-4 text-sm text-danger">{row.parseErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
        {row.transactionId ? <Link to={`/transactions/${row.transactionId}`} className="mt-5 inline-flex text-sm font-bold text-primary">View ledger transaction</Link> : null}
      </div>

      {!actionable ? <ReadOnlyOutcome status={row.reviewStatus} /> : !unallocated ? <div className="p-6 text-sm text-danger">No active bucket is available. Restore or create a bucket before reviewing this row.</div> : (
        <ClassificationEditor
          batchId={batchId}
          row={row}
          buckets={activeBuckets}
          categories={activeCategories}
          defaultBucketId={unallocated.id}
          suggestions={suggestions.data ?? []}
          suggestionsPending={suggestions.isPending}
          suggestionsError={suggestions.error}
          onResolved={onResolved}
        />
      )}
    </Panel>
  );
}

function ClassificationEditor({ batchId, row, buckets, categories, defaultBucketId, suggestions, suggestionsPending, suggestionsError, onResolved }: { batchId: string; row: ImportedRow; buckets: Bucket[]; categories: Category[]; defaultBucketId: string; suggestions: Suggestion[]; suggestionsPending: boolean; suggestionsError: unknown; onResolved: (message: string) => void }) {
  const amount = row.amount ?? "0";
  const form = useForm<ReviewValues>({ defaultValues: initialReviewValues(amount, defaultBucketId) });
  const entries = useFieldArray({ control: form.control, name: "bucketEntries" });
  const watched = useWatch({ control: form.control }) as ReviewValues;
  const total = reviewTotal(watched);
  const categorize = useCategorizeImportedRow(batchId);
  const skip = useSkipImportedRow(batchId);
  const [formError, setFormError] = useState<string | null>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const balanced = !total.invalid && total.amount === amount;

  const applySuggestion = (suggestion: Suggestion) => {
    const current = form.getValues("bucketEntries.0");
    if (!current) return;
    const bucketId = suggestion.bucketId && buckets.some((bucket) => bucket.id === suggestion.bucketId) ? suggestion.bucketId : current.bucketId;
    const categoryId = suggestion.categoryId && categories.some((category) => category.id === suggestion.categoryId) ? suggestion.categoryId : "";
    entries.update(0, { ...current, bucketId, categoryId });
    setFormError(null);
  };

  const submit = form.handleSubmit((values) => {
    setFormError(null);
    try {
      const body = buildCategorization(values, amount);
      void categorize.mutateAsync({ rowId: row.id, body })
        .then(() => onResolved("Categorization saved."))
        .catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The categorization is invalid.";
      setFormError(message);
      if (entries.fields.length === 0) return;
      const field = message.includes("bucket") ? "bucketEntries.0.bucketId" : "bucketEntries.0.amount";
      form.setError(field, { message }, { shouldFocus: true });
    }
  });

  useEffect(() => {
    const element = formElement.current;
    if (!element) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
      event.preventDefault();
      void submit();
    };
    element.addEventListener("keydown", handleKeyDown);
    return () => element.removeEventListener("keydown", handleKeyDown);
  }, [submit]);

  return (
    <form ref={formElement} onSubmit={(event) => void submit(event)}>
      <div className="border-b border-line p-5 sm:p-6">
        <div className="flex items-center gap-2"><Lightbulb className="size-4 text-warning" /><h3 className="text-sm font-bold">Rule suggestions</h3></div>
        {suggestionsPending ? <p className="mt-3 text-xs text-ink-muted">Checking your categorization rules…</p> : suggestionsError ? <p className="mt-3 text-xs text-danger">Suggestions could not be loaded. You can still categorize manually.</p> : suggestions.length === 0 ? <p className="mt-3 text-xs text-ink-muted">No enabled rules match this row.</p> : (
          <div className="mt-3 flex flex-wrap gap-2">{suggestions.map((suggestion) => <Button key={suggestion.ruleId} variant="secondary" className="h-auto min-h-10 py-2" onClick={() => applySuggestion(suggestion)}><span className="text-left"><span className="block">{suggestion.ruleName}</span>{suggestion.transactionKind ? <span className="block text-[0.7rem] font-normal text-ink-muted">Kind hint: {humanize(suggestion.transactionKind)}</span> : null}</span></Button>)}</div>
        )}
      </div>

      <div>
        <PanelHeader title="BucketEntries" action={<Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => entries.append({ bucketId: defaultBucketId, categoryId: "", amount: "0.00", memo: "" })}><Plus className="size-3.5" /> Split</Button>} />
        <div className="divide-y divide-line">
          {entries.fields.map((field, index) => (
            <div key={field.id} className="grid gap-3 p-5 md:grid-cols-[1fr_1fr_8rem_auto] md:items-end sm:px-6">
              <div><Label htmlFor={`review-bucket-${index}`}>Bucket</Label><Select id={`review-bucket-${index}`} {...form.register(`bucketEntries.${index}.bucketId`)}>{buckets.map((bucket) => <option key={bucket.id} value={bucket.id}>{bucket.name}</option>)}</Select></div>
              <div><Label htmlFor={`review-category-${index}`}>Category <span className="font-normal text-ink-muted">(optional)</span></Label><Select id={`review-category-${index}`} {...form.register(`bucketEntries.${index}.categoryId`)}><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name} · {humanize(category.kind)}</option>)}</Select></div>
              <div><Label htmlFor={`review-amount-${index}`}>Amount (₹)</Label><Input id={`review-amount-${index}`} inputMode="decimal" {...form.register(`bucketEntries.${index}.amount`)} /></div>
              <Button variant="ghost" className="size-10 px-0 text-danger" aria-label={`Remove BucketEntry ${index + 1}`} onClick={() => entries.remove(index)}><Trash2 className="size-4" /></Button>
              <div className="md:col-span-4"><Label htmlFor={`review-memo-${index}`}>Memo <span className="font-normal text-ink-muted">(optional)</span></Label><Input id={`review-memo-${index}`} {...form.register(`bucketEntries.${index}.memo`)} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-canvas p-4">
          <div><p className="text-xs text-ink-muted">Assigned / imported</p><div className="mt-1 flex items-center gap-2"><Money amount={total.amount} colorize showPlus className="font-bold" /><span className="text-ink-muted">/</span><Money amount={amount} colorize showPlus className="font-bold" /></div></div>
          <Badge tone={balanced ? "positive" : "danger"}>{total.invalid ? "Check amounts" : balanced ? "Balanced" : "Not balanced"}</Badge>
        </div>
        {formError || categorize.error || skip.error ? <p className="mt-4 rounded-xl bg-danger-soft p-4 text-sm text-danger" role="alert">{formError ?? categorize.error?.message ?? skip.error?.message}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <ConfirmDialog trigger={<Button disabled={skip.isPending || categorize.isPending}><SkipForward className="size-4" /> Skip row</Button>} title="Leave this row unallocated?" description="The imported ledger transaction remains posted in Unallocated. You can inspect it later, but this review row will be marked skipped." confirmLabel="Skip row" pending={skip.isPending} onConfirm={() => { void skip.mutateAsync(row.id).then(() => onResolved("Row skipped.")).catch(() => undefined); }} />
          <Button variant="primary" type="submit" disabled={!balanced || categorize.isPending || skip.isPending}><Check className="size-4" /> {categorize.isPending ? "Saving…" : "Save categorization"}</Button>
        </div>
      </div>
    </form>
  );
}

function Evidence({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return <div><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 font-semibold text-ink">{children ?? value}</dd></div>;
}

function ReadOnlyOutcome({ status }: { status: string }) {
  const messages: Record<string, string> = {
    reviewed: "This row has been categorized and is retained here as import evidence.",
    skipped: "This row was skipped. Its transaction remains assigned to Unallocated.",
    duplicate: "This row matches an earlier imported row, so no new transaction was created.",
    invalid: "This row could not be parsed, so no transaction was created.",
  };
  return <div className="p-6 text-sm leading-6 text-ink-muted">{messages[status] ?? "This row is not awaiting review."}</div>;
}
