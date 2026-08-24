import { useQuery } from "@tanstack/react-query";
import { FileCog, Plus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch, type UseFormRegisterReturn } from "react-hook-form";

import { parserProfilesQuery } from "../../api/queries";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { FieldError, Input, Label, Select } from "../../components/ui/form";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel } from "../../components/ui/panel";
import { humanize } from "../../lib/strings";
import { emptyCSVMapping, guessCSVMapping, parseCSVHeader } from "../imports/csv-mapping";
import { useCreateParserProfile } from "./mutations";
import { buildParserProfile, mappingField, type ProfileFormValues } from "./profile-model";

const dateFormats = [
  { value: "02/01/2006", label: "DD/MM/YYYY" },
  { value: "2006-01-02", label: "YYYY-MM-DD" },
  { value: "01/02/2006", label: "MM/DD/YYYY" },
  { value: "02-01-2006", label: "DD-MM-YYYY" },
];

export function ParserProfilesPage() {
  const profiles = useQuery(parserProfilesQuery);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (profiles.isPending) return <LoadingState label="Loading parser profiles…" />;
  if (profiles.error) return <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} />;
  if (!profiles.data) return <LoadingState label="Loading parser profiles…" />;

  return (
    <>
      <PageHeader eyebrow="Statement formats" title="Parser profiles" description="Save versioned column mappings for statement layouts you import repeatedly." action={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New profile</Button>} />
      <div className="mb-6 rounded-2xl border border-line bg-info-soft px-5 py-4 text-sm leading-6 text-ink-muted"><strong className="text-ink">Profiles are immutable versions.</strong> Create a new version when a bank changes its export. Existing imports keep their original profile reference for audit history.</div>
      {notice ? <p className="mb-5 rounded-xl bg-primary-soft p-4 text-sm text-primary-strong" role="status">{notice}</p> : null}
      <Panel className="overflow-hidden">
        {profiles.data.length === 0 ? <EmptyState title="No parser profiles" description="Create a CSV mapping to reuse it during future statement uploads." /> : (
          <div className="divide-y divide-line">{profiles.data.map((profile) => (
            <article key={profile.id} className="grid gap-4 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-6">
              <span className="hidden rounded-xl bg-primary-soft p-3 text-primary sm:inline-flex"><FileCog className="size-5" /></span>
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold">{profile.name}</h2><Badge tone={profile.format === "csv" ? "positive" : "neutral"}>{profile.format.toUpperCase()}</Badge></div><p className="mt-1 text-xs text-ink-muted">{profile.institution || "Any institution"} · version {profile.parserVersion}</p>{profile.format === "csv" ? <p className="mt-2 text-xs leading-5 text-ink-muted">Date: {mappingField(profile.mapping, "dateColumn") || "—"} · Description: {mappingField(profile.mapping, "descriptionColumn") || "—"} · Amount: {mappingField(profile.mapping, "amountColumn") || `${mappingField(profile.mapping, "debitColumn")} / ${mappingField(profile.mapping, "creditColumn")}`}</p> : null}</div>
              <p className="text-xs font-semibold text-ink-muted">{humanize(profile.format)} parser</p>
            </article>
          ))}</div>
        )}
      </Panel>
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="New CSV parser profile" description="Use exact column names from the statement header, or choose a sample CSV to infer them.">
        <ParserProfileForm onCancel={() => setCreateOpen(false)} onCreated={(name) => { setCreateOpen(false); setNotice(`Parser profile “${name}” created.`); }} />
      </Dialog>
    </>
  );
}

function ParserProfileForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (name: string) => void }) {
  const mutation = useCreateParserProfile();
  const [columns, setColumns] = useState<string[]>([]);
  const form = useForm<ProfileFormValues>({ defaultValues: { name: "", institution: "", parserVersion: "1", amountMode: "split", ...emptyCSVMapping } });
  const amountMode = useWatch({ control: form.control, name: "amountMode" });

  const loadSample = async (file: File | null) => {
    if (!file) return;
    try {
      const nextColumns = parseCSVHeader(await file.slice(0, 64 * 1024).text());
      const guessed = guessCSVMapping(nextColumns);
      setColumns(nextColumns);
      const current = form.getValues();
      form.reset({ ...current, ...guessed, amountMode: guessed.amountColumn ? "signed" : "split" });
      form.clearErrors();
    } catch (error) {
      form.setError("dateColumn", { message: error instanceof Error ? error.message : "The CSV header could not be read." }, { shouldFocus: true });
    }
  };

  const submit = form.handleSubmit((values) => {
    form.clearErrors();
    try {
      const command = buildParserProfile(values);
      mutation.mutate(command, { onSuccess: () => onCreated(command.name) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The parser profile is invalid.";
      const field = message.includes("name") ? "name" : message.includes("Version") ? "parserVersion" : message.includes("date") ? "dateColumn" : message.includes("description") ? "descriptionColumn" : values.amountMode === "signed" ? "amountColumn" : "debitColumn";
      form.setError(field, { message }, { shouldFocus: true });
    }
  });

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <div><Label htmlFor="profile-name">Profile name</Label><Input id="profile-name" placeholder="e.g. HDFC savings CSV" {...form.register("name", { required: "Profile name is required." })} /><FieldError>{form.formState.errors.name?.message}</FieldError></div>
        <div><Label htmlFor="profile-version">Version</Label><Input id="profile-version" {...form.register("parserVersion", { required: "Version is required." })} /><FieldError>{form.formState.errors.parserVersion?.message}</FieldError></div>
      </div>
      <div><Label htmlFor="profile-institution">Institution <span className="font-normal text-ink-muted">(optional)</span></Label><Input id="profile-institution" {...form.register("institution")} /></div>
      <div><Label htmlFor="profile-sample">Sample CSV <span className="font-normal text-ink-muted">(optional)</span></Label><Input id="profile-sample" type="file" accept=".csv,text/csv" onChange={(event) => void loadSample(event.target.files?.[0] ?? null)} /><p className="mt-2 text-xs text-ink-muted">Only the header is read in the browser; this sample is not uploaded.</p></div>
      <datalist id="profile-columns">{columns.map((column) => <option key={column} value={column} />)}</datalist>
      <div className="grid gap-4 sm:grid-cols-2">
        <ProfileColumn id="profile-date" label="Date column" list="profile-columns" registration={form.register("dateColumn")} error={form.formState.errors.dateColumn?.message} />
        <ProfileColumn id="profile-description" label="Description column" list="profile-columns" registration={form.register("descriptionColumn")} error={form.formState.errors.descriptionColumn?.message} />
        <ProfileColumn id="profile-reference" label="Reference column (optional)" list="profile-columns" registration={form.register("referenceColumn")} />
        <ProfileColumn id="profile-balance" label="Balance column (optional)" list="profile-columns" registration={form.register("balanceColumn")} />
        <div><Label htmlFor="profile-date-format">Date format</Label><Select id="profile-date-format" {...form.register("dateFormat")}>{dateFormats.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}</Select></div>
      </div>
      <fieldset className="rounded-xl border border-line p-4"><legend className="px-2 text-xs font-bold text-ink">Amount columns</legend><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="radio" value="signed" {...form.register("amountMode")} /> One signed amount</label><label className="flex items-center gap-2"><input type="radio" value="split" {...form.register("amountMode")} /> Separate debit and credit</label></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{amountMode === "signed" ? <ProfileColumn id="profile-amount" label="Amount column" list="profile-columns" registration={form.register("amountColumn")} error={form.formState.errors.amountColumn?.message} /> : <><ProfileColumn id="profile-debit" label="Debit column" list="profile-columns" registration={form.register("debitColumn")} error={form.formState.errors.debitColumn?.message} /><ProfileColumn id="profile-credit" label="Credit column" list="profile-columns" registration={form.register("creditColumn")} /></>}</div></fieldset>
      {mutation.error ? <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{mutation.error.message}</p> : null}
      <div className="flex justify-end gap-3"><Button onClick={onCancel} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating…" : "Create profile"}</Button></div>
    </form>
  );
}

function ProfileColumn({ id, label, list, registration, error }: { id: string; label: string; list: string; registration: UseFormRegisterReturn; error?: string }) {
  return <div><Label htmlFor={id}>{label}</Label><Input id={id} list={list} {...registration} /><FieldError>{error}</FieldError></div>;
}
