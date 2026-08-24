import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { bucketsQuery, categoriesQuery, rulesQuery, type Bucket, type Category } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Dialog } from "../../components/ui/dialog";
import { FieldError, Input, Label, Select } from "../../components/ui/form";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel } from "../../components/ui/panel";
import { humanize } from "../../lib/strings";
import { useCreateRule, useDeleteRule } from "./mutations";
import { buildRuleCommand, describeConditions, type RuleFormValues } from "./rule-model";

export function RulesPage() {
  const rules = useQuery(rulesQuery);
  const buckets = useQuery(bucketsQuery);
  const categories = useQuery(categoriesQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const deleteRule = useDeleteRule();
  const queries = [rules, buckets, categories];

  if (queries.some((query) => query.isPending)) return <LoadingState label="Loading categorization rules…" />;
  const error = queries.find((query) => query.error)?.error;
  if (error) return <ErrorState error={error} onRetry={() => void Promise.all(queries.map((query) => query.refetch()))} />;
  if (!rules.data || !buckets.data || !categories.data) return <LoadingState label="Loading categorization rules…" />;

  const bucketNames = new Map(buckets.data.map((bucket) => [bucket.id, bucket.name]));
  const categoryNames = new Map(categories.data.map((category) => [category.id, category.name]));

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Categorization rules"
        description="Deterministic rules suggest how imported transactions should be classified, while preserving an inspectable reason for every match. Suggestions still require review."
        action={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New rule</Button>}
      />
      {notice ? <p className="mb-5 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong" role="status">{notice}</p> : null}
      {deleteRule.error ? <p className="mb-5 rounded-xl bg-danger-soft p-4 text-sm text-danger" role="alert">{deleteRule.error.message}</p> : null}
      <Panel className="overflow-hidden">
        {rules.data.length === 0 ? (
          <EmptyState title="No rules yet" description="Create rules for recurring merchants, descriptions, and amount ranges." />
        ) : (
          <div className="divide-y divide-line">
            {rules.data.map((rule) => {
              const conditions = describeConditions(rule.conditions);
              return (
                <article key={rule.id} className="grid gap-4 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-6">
                  <span className="hidden rounded-xl bg-primary-soft p-3 text-primary sm:inline-flex"><WandSparkles className="size-5" aria-hidden="true" /></span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold">{rule.name}</h2>
                      <Badge tone={rule.enabled ? "positive" : "neutral"}>{rule.enabled ? "Enabled" : "Disabled"}</Badge>
                      {rule.autoApply ? <Badge tone="warning">Trusted metadata</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">{conditions.length ? conditions.join(" · ") : "Matches every imported row"}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Suggest {rule.bucketId ? bucketNames.get(rule.bucketId) ?? "unknown bucket" : "no bucket"}
                      {rule.categoryId ? ` · ${categoryNames.get(rule.categoryId) ?? "unknown category"}` : ""}
                      {rule.transactionKind ? ` · ${humanize(rule.transactionKind)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <div className="sm:text-right"><p className="text-xs text-ink-muted">Priority</p><p className="mt-1 text-sm font-bold tabular-nums">{rule.priority}</p></div>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" className="size-10 px-0 text-danger" aria-label={`Delete rule ${rule.name}`} disabled={deleteRule.isPending}><Trash2 className="size-4" /></Button>}
                      title="Delete this categorization rule?"
                      description="Future imported rows will no longer receive this suggestion. Existing transactions and reviewed imports are unchanged."
                      confirmLabel="Delete rule"
                      pending={deleteRule.isPending}
                      onConfirm={() => deleteRule.mutate(rule.id, { onSuccess: () => setNotice(`Rule “${rule.name}” deleted.`) })}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="New categorization rule" description="Choose when the rule matches and which bucket or category it should suggest during import review.">
        <RuleForm buckets={buckets.data} categories={categories.data} onCancel={() => setCreateOpen(false)} onCreated={(name) => { setCreateOpen(false); setNotice(`Rule “${name}” created.`); }} />
      </Dialog>
    </>
  );
}

function RuleForm({ buckets, categories, onCancel, onCreated }: { buckets: Bucket[]; categories: Category[]; onCancel: () => void; onCreated: (name: string) => void }) {
  const activeBuckets = useMemo(() => buckets.filter((bucket) => !bucket.archived), [buckets]);
  const activeCategories = useMemo(() => categories.filter((category) => !category.archived), [categories]);
  const mutation = useCreateRule();
  const form = useForm<RuleFormValues>({ defaultValues: { name: "", priority: "0", descriptionContains: "", direction: "", minimumAmount: "", maximumAmount: "", bucketId: "", categoryId: "" } });

  const submit = form.handleSubmit((values) => {
    form.clearErrors();
    try {
      const command = buildRuleCommand(values);
      mutation.mutate(command, { onSuccess: () => onCreated(command.name) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The rule is invalid.";
      const field = message.includes("name") ? "name" : message.includes("Priority") ? "priority" : message.includes("Minimum") ? "minimumAmount" : message.includes("Maximum") ? "maximumAmount" : message.includes("suggested") ? "bucketId" : "descriptionContains";
      form.setError(field, { message }, { shouldFocus: true });
    }
  });

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <div><Label htmlFor="rule-name">Rule name</Label><Input id="rule-name" {...form.register("name", { required: "Rule name is required." })} /><FieldError>{form.formState.errors.name?.message}</FieldError></div>
        <div><Label htmlFor="rule-priority">Priority</Label><Input id="rule-priority" inputMode="numeric" {...form.register("priority")} /><FieldError>{form.formState.errors.priority?.message}</FieldError></div>
      </div>

      <fieldset className="rounded-xl border border-line p-4">
        <legend className="px-2 text-xs font-bold text-ink">Match when</legend>
        <div><Label htmlFor="rule-description">Description contains</Label><Input id="rule-description" placeholder="e.g. SWIGGY" {...form.register("descriptionContains")} /><FieldError>{form.formState.errors.descriptionContains?.message}</FieldError></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div><Label htmlFor="rule-direction">Direction</Label><Select id="rule-direction" {...form.register("direction")}><option value="">Either</option><option value="debit">Money out</option><option value="credit">Money in</option></Select></div>
          <div><Label htmlFor="rule-minimum">Minimum (₹)</Label><Input id="rule-minimum" inputMode="decimal" placeholder="Optional" {...form.register("minimumAmount")} /><FieldError>{form.formState.errors.minimumAmount?.message}</FieldError></div>
          <div><Label htmlFor="rule-maximum">Maximum (₹)</Label><Input id="rule-maximum" inputMode="decimal" placeholder="Optional" {...form.register("maximumAmount")} /><FieldError>{form.formState.errors.maximumAmount?.message}</FieldError></div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line p-4">
        <legend className="px-2 text-xs font-bold text-ink">Suggest</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="rule-bucket">Bucket <span className="font-normal text-ink-muted">(optional)</span></Label><Select id="rule-bucket" {...form.register("bucketId")}><option value="">Keep current bucket</option>{activeBuckets.map((bucket) => <option key={bucket.id} value={bucket.id}>{bucket.name}</option>)}</Select><FieldError>{form.formState.errors.bucketId?.message}</FieldError></div>
          <div><Label htmlFor="rule-category">Category <span className="font-normal text-ink-muted">(optional)</span></Label><Select id="rule-category" {...form.register("categoryId")}><option value="">Uncategorized</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name} · {humanize(category.kind)}</option>)}</Select></div>
        </div>
        <p className="mt-3 text-xs leading-5 text-ink-muted">Choose at least one result. Matching rules appear as reviewable suggestions; they do not silently change imported transactions.</p>
      </fieldset>

      {mutation.error ? <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{mutation.error.message}</p> : null}
      <div className="flex justify-end gap-3"><Button onClick={onCancel} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating…" : "Create rule"}</Button></div>
    </form>
  );
}
