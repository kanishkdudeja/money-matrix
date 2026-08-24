import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleEqual, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router";

import { accountsQuery, bucketsQuery, categoriesQuery, type Account, type Bucket, type Category } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { buttonStyles } from "../../components/ui/button-styles";
import { Input, Label, Select } from "../../components/ui/form";
import { Money } from "../../components/ui/money";
import { ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel, PanelHeader } from "../../components/ui/panel";
import { humanize } from "../../lib/strings";
import { useCreateTransaction } from "./mutations";
import {
  buildTransactionCommand,
  editorTotals,
  presetValues,
  transactionKinds,
  type TransactionEditorValues,
  type TransactionKind,
} from "./transaction-editor-model";

export function TransactionEditorPage() {
  const accounts = useQuery(accountsQuery);
  const buckets = useQuery(bucketsQuery);
  const categories = useQuery(categoriesQuery);
  const navigate = useNavigate();
  const mutation = useCreateTransaction();
  const [formError, setFormError] = useState<string | null>(null);
  const queries = [accounts, buckets, categories];

  if (queries.some((query) => query.isPending)) return <LoadingState label="Preparing transaction editor…" />;
  const queryError = queries.find((query) => query.error)?.error;
  if (queryError) return <ErrorState error={queryError} onRetry={() => void Promise.all(queries.map((query) => query.refetch()))} />;
  if (!accounts.data || !buckets.data || !categories.data) return <LoadingState label="Preparing transaction editor…" />;

  return (
    <LoadedTransactionEditor
      accounts={accounts.data}
      buckets={buckets.data}
      categories={categories.data}
      mutation={mutation}
      formError={formError}
      setFormError={setFormError}
      onCreated={(id) => void navigate(`/transactions/${id}`, { replace: true, state: { notice: "Transaction posted successfully." } })}
    />
  );
}

type LoadedProps = {
  accounts: Account[];
  buckets: Bucket[];
  categories: Category[];
  mutation: ReturnType<typeof useCreateTransaction>;
  formError: string | null;
  setFormError: (message: string | null) => void;
  onCreated: (id: string) => void;
};

function LoadedTransactionEditor({ accounts, buckets, categories, mutation, formError, setFormError, onCreated }: LoadedProps) {
  const activeAccounts = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);
  const activeBuckets = useMemo(() => buckets.filter((bucket) => !bucket.archived), [buckets]);
  const activeCategories = useMemo(() => categories.filter((category) => !category.archived), [categories]);
  const form = useForm<TransactionEditorValues>({ defaultValues: presetValues("expense", accounts, buckets, categories) });
  const postings = useFieldArray({ control: form.control, name: "postings" });
  const bucketEntries = useFieldArray({ control: form.control, name: "bucketEntries" });
  const values = useWatch({ control: form.control });
  const safeValues = values as TransactionEditorValues;
  const totals = editorTotals(safeValues, accounts);
  const selectedKind = safeValues.kind;

  const applyPreset = (kind: TransactionKind) => {
    const current = form.getValues();
    const next = presetValues(kind, accounts, buckets, categories);
    form.reset({ ...next, occurredOn: current.occurredOn, description: current.description });
    setFormError(null);
  };

  if (activeAccounts.length === 0) {
    return (
      <>
        <PageHeader title="Manual transaction" description="A financial account is required before recording ledger activity." />
        <Panel className="p-8 text-center"><p className="text-sm text-ink-muted">Create or restore an account first.</p><Link to="/accounts" className="mt-4 inline-flex text-sm font-bold text-primary">Go to accounts</Link></Panel>
      </>
    );
  }

  return (
    <>
      <Link to="/transactions" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary-strong"><ArrowLeft className="size-4" /> Transactions</Link>
      <PageHeader
        eyebrow="New ledger event"
        title="Manual transaction"
        description="Choose the real-world intent, then review the exact signed effects. The transaction is posted atomically only when account coverage and bucket purpose agree."
      />

      <form
        onSubmit={(event) => void form.handleSubmit((submitted) => {
          setFormError(null);
          try {
            const command = buildTransactionCommand(submitted, accounts, buckets, categories);
            mutation.mutate(command, { onSuccess: (created) => onCreated(created.id) });
          } catch (error) {
            const message = error instanceof Error ? error.message : "The transaction is invalid.";
            setFormError(message);
            const field = !submitted.description.trim()
              ? "description"
              : !submitted.occurredOn
                ? "occurredOn"
                : message.includes("account")
                  ? "postings.0.accountId"
                  : message.includes("posting") || (message.includes("amount") && submitted.postings.length > 0)
                    ? "postings.0.amount"
                    : message.includes("category")
                      ? "bucketEntries.0.categoryId"
                      : "bucketEntries.0.amount";
            form.setError(field, { message }, { shouldFocus: true });
          }
        })(event)}
        className="space-y-6"
      >
        <Panel className="p-5 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_12rem]">
            <div>
              <Label htmlFor="transaction-description">Description</Label>
              <Input id="transaction-description" placeholder="e.g. Groceries at the market" {...form.register("description", { required: true })} />
            </div>
            <div>
              <Label htmlFor="transaction-date">Date</Label>
              <Input id="transaction-date" type="date" {...form.register("occurredOn", { required: true })} />
            </div>
          </div>
          <div className="mt-5">
            <Label htmlFor="transaction-kind">Intent preset</Label>
            <Select id="transaction-kind" value={selectedKind} onChange={(event) => applyPreset(event.target.value as TransactionKind)}>
              {transactionKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label} — {kind.hint}</option>)}
            </Select>
          </div>
        </Panel>

        <div className="rounded-2xl border border-line bg-info-soft px-5 py-4 text-sm leading-6 text-ink-muted">
          <strong className="text-ink">Signed-entry guide:</strong> positive postings increase an account’s displayed balance; negative postings decrease it. Liability postings have the opposite effect on financial coverage. BucketEntries use available-purpose perspective: positive reserves/adds, negative consumes/removes.
        </div>

        {selectedKind !== "bucket_transfer" ? (
          <Panel className="overflow-hidden">
            <PanelHeader title="Account postings" action={<Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => postings.append({ accountId: activeAccounts[0]?.id ?? "", amount: "0.00", memo: "" })}><Plus className="size-3.5" /> Add posting</Button>} />
            <div className="divide-y divide-line">
              {postings.fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.7fr)_minmax(0,1fr)_auto] sm:items-end sm:px-6">
                  <div><Label htmlFor={`posting-account-${index}`}>Account</Label><Select id={`posting-account-${index}`} {...form.register(`postings.${index}.accountId`)}>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {humanize(account.balanceClass)}</option>)}</Select></div>
                  <div><Label htmlFor={`posting-amount-${index}`}>Signed amount (₹)</Label><Input id={`posting-amount-${index}`} inputMode="decimal" {...form.register(`postings.${index}.amount`)} /></div>
                  <div><Label htmlFor={`posting-memo-${index}`}>Memo <span className="font-normal text-ink-muted">(optional)</span></Label><Input id={`posting-memo-${index}`} {...form.register(`postings.${index}.memo`)} /></div>
                  <Button variant="ghost" className="size-10 px-0 text-danger" aria-label={`Remove posting ${index + 1}`} onClick={() => postings.remove(index)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        <Panel className="overflow-hidden">
          <PanelHeader title="BucketEntries" action={<Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => bucketEntries.append({ bucketId: activeBuckets[0]?.id ?? "", categoryId: "", amount: "0.00", memo: "" })}><Plus className="size-3.5" /> Add entry</Button>} />
          {bucketEntries.fields.length === 0 ? <p className="px-6 py-7 text-sm text-ink-muted">No entries supplied. Any non-zero coverage change will go to Unallocated automatically.</p> : (
            <div className="divide-y divide-line">
              {bucketEntries.fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.65fr)_minmax(0,1fr)_auto] md:items-end sm:px-6">
                  <div><Label htmlFor={`entry-bucket-${index}`}>Bucket</Label><Select id={`entry-bucket-${index}`} {...form.register(`bucketEntries.${index}.bucketId`)}>{activeBuckets.map((bucket) => <option key={bucket.id} value={bucket.id}>{bucket.name}</option>)}</Select></div>
                  <div><Label htmlFor={`entry-category-${index}`}>Category <span className="font-normal text-ink-muted">(optional)</span></Label><Select id={`entry-category-${index}`} disabled={selectedKind === "bucket_transfer"} {...form.register(`bucketEntries.${index}.categoryId`)}><option value="">Uncategorized</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name} · {humanize(category.kind)}</option>)}</Select></div>
                  <div><Label htmlFor={`entry-amount-${index}`}>Signed amount (₹)</Label><Input id={`entry-amount-${index}`} inputMode="decimal" {...form.register(`bucketEntries.${index}.amount`)} /></div>
                  <div><Label htmlFor={`entry-memo-${index}`}>Memo <span className="font-normal text-ink-muted">(optional)</span></Label><Input id={`entry-memo-${index}`} {...form.register(`bucketEntries.${index}.memo`)} /></div>
                  <Button variant="ghost" className="size-10 px-0 text-danger" aria-label={`Remove BucketEntry ${index + 1}`} onClick={() => bucketEntries.remove(index)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <div><p className="text-xs text-ink-muted">Financial coverage change</p><Money amount={totals.coverage} colorize showPlus className="mt-1 block text-lg font-bold" /></div>
            <CircleEqual className="hidden size-5 text-ink-muted sm:block" />
            <div><p className="text-xs text-ink-muted">BucketEntry total</p><Money amount={totals.bucketTotal} colorize showPlus className="mt-1 block text-lg font-bold" /></div>
            <span className="hidden text-xs font-bold text-ink-muted sm:block">Difference</span>
            <div className="flex items-center gap-3"><Money amount={totals.difference} colorize className="text-lg font-bold" /><Badge tone={!totals.invalidAmounts && (totals.difference === "0" || bucketEntries.fields.length === 0) ? "positive" : "danger"}>{totals.invalidAmounts ? "Check amounts" : totals.difference === "0" || bucketEntries.fields.length === 0 ? "Ready" : "Not balanced"}</Badge></div>
          </div>
          {bucketEntries.fields.length === 0 && totals.coverage !== "0" ? <p className="mt-4 text-xs text-warning">The backend will create one matching Unallocated entry.</p> : null}
        </Panel>

        {formError || mutation.error ? <p className="rounded-xl bg-danger-soft p-4 text-sm text-danger" role="alert">{formError ?? mutation.error?.message}</p> : null}
        <div className="flex justify-end gap-3"><Link to="/transactions" className={buttonStyles()}>Cancel</Link><Button variant="primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Posting…" : "Post transaction"}</Button></div>
      </form>
    </>
  );
}
