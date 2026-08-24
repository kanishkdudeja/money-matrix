import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { accountsQuery, parserProfilesQuery } from "../../api/queries";
import { Button } from "../../components/ui/button";
import { buttonStyles } from "../../components/ui/button-styles";
import { Input, Label, Select } from "../../components/ui/form";
import { ErrorState, LoadingState, PageHeader } from "../../components/ui/page";
import { Panel, PanelHeader } from "../../components/ui/panel";
import { humanize } from "../../lib/strings";
import { emptyCSVMapping, guessCSVMapping, parseCSVHeader, validateCSVMapping, type CSVMapping } from "./csv-mapping";
import { useUploadCSV } from "./mutations";

const dateFormats = [
  { value: "02/01/2006", label: "DD/MM/YYYY" },
  { value: "2006-01-02", label: "YYYY-MM-DD" },
  { value: "01/02/2006", label: "MM/DD/YYYY" },
  { value: "02-01-2006", label: "DD-MM-YYYY" },
];

type MappingField = Exclude<keyof CSVMapping, "dateFormat">;

export function ImportUploadPage() {
  const accounts = useQuery(accountsQuery);
  const profiles = useQuery(parserProfilesQuery);
  const mutation = useUploadCSV();
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CSVMapping>(emptyCSVMapping);
  const [amountMode, setAmountMode] = useState<"signed" | "split">("split");
  const [formError, setFormError] = useState<string | null>(null);
  const queries = [accounts, profiles];

  const activeAccounts = useMemo(() => accounts.data?.filter((account) => !account.archived) ?? [], [accounts.data]);
  const csvProfiles = profiles.data?.filter((profile) => profile.format === "csv") ?? [];
  const chosenAccountId = accountId || activeAccounts[0]?.id || "";

  if (queries.some((query) => query.isPending)) return <LoadingState label="Preparing statement upload…" />;
  const queryError = queries.find((query) => query.error)?.error;
  if (queryError) return <ErrorState error={queryError} onRetry={() => void Promise.all(queries.map((query) => query.refetch()))} />;

  const updateMapping = (field: MappingField, value: string) => setMapping((current) => ({ ...current, [field]: value }));
  const fail = (message: string, fieldId: string) => {
    setFormError(message);
    requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
  };

  const chooseFile = async (nextFile: File | null) => {
    setFile(nextFile);
    setColumns([]);
    setFormError(null);
    if (!nextFile) return;
    if (nextFile.size > 20 * 1024 * 1024) {
      fail("Choose a CSV file no larger than 20 MB.", "statement-file");
      return;
    }
    try {
      const header = parseCSVHeader(await nextFile.slice(0, 64 * 1024).text());
      if (header.length < 2 || header.some((column) => !column)) throw new Error("The CSV needs a non-empty header row.");
      const guessed = guessCSVMapping(header);
      setColumns(header);
      setMapping(guessed);
      setAmountMode(guessed.amountColumn ? "signed" : "split");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The CSV header could not be read.");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!chosenAccountId) return fail("Create or restore an account before uploading a statement.", "import-account");
    if (!file) return fail("Choose a CSV statement.", "statement-file");
    if (file.size > 20 * 1024 * 1024) return fail("Choose a CSV file no larger than 20 MB.", "statement-file");
    if (!profileId) {
      const finalMapping = amountMode === "signed"
        ? { ...mapping, debitColumn: "", creditColumn: "" }
        : { ...mapping, amountColumn: "" };
      const validationError = validateCSVMapping(finalMapping);
      if (validationError) {
        const fieldId = !finalMapping.dateColumn ? "mapping-date" : !finalMapping.descriptionColumn ? "mapping-description" : amountMode === "signed" ? "mapping-amount" : !finalMapping.debitColumn ? "mapping-debit" : "mapping-credit";
        return fail(validationError, fieldId);
      }
      mutation.mutate({ accountId: chosenAccountId, file, mapping: finalMapping }, {
        onSuccess: (batch) => void navigate(`/imports/${batch.id}`, { replace: true }),
      });
      return;
    }
    mutation.mutate({ accountId: chosenAccountId, file, profileId }, {
      onSuccess: (batch) => void navigate(`/imports/${batch.id}`, { replace: true }),
    });
  };

  return (
    <>
      <Link to="/imports" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary-strong"><ArrowLeft className="size-4" /> Imports</Link>
      <PageHeader eyebrow="New statement" title="Upload CSV" description="Select the account, map your bank’s columns, then review every new row before considering the import complete." />

      <form onSubmit={submit} className="space-y-6">
        <Panel className="p-5 sm:p-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <Label htmlFor="import-account">Financial account</Label>
              <Select id="import-account" value={chosenAccountId} onChange={(event) => setAccountId(event.target.value)} disabled={activeAccounts.length === 0}>
                {activeAccounts.length === 0 ? <option value="">No active accounts</option> : null}
                {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {humanize(account.balanceClass)}</option>)}
              </Select>
              <p className="mt-2 text-xs leading-5 text-ink-muted">Choose the account represented by this statement, including credit cards and loans.</p>
            </div>
            <div>
              <Label htmlFor="statement-file">CSV statement</Label>
              <Input id="statement-file" type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} />
              <p className="mt-2 text-xs text-ink-muted">Comma-separated CSV, up to 20 MB.</p>
            </div>
          </div>
        </Panel>

        {file ? (
          <Panel className="overflow-hidden">
            <PanelHeader title="Column mapping" action={<span className="inline-flex items-center gap-2 text-xs font-medium text-ink-muted"><FileSpreadsheet className="size-4" /> {file.name}</span>} />
            <div className="space-y-6 p-5 sm:p-6">
              {csvProfiles.length > 0 ? (
                <div>
                  <Label htmlFor="parser-profile">Saved mapping <span className="font-normal text-ink-muted">(optional)</span></Label>
                  <Select id="parser-profile" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                    <option value="">Map this file below</option>
                    {csvProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.institution ? ` · ${profile.institution}` : ""}</option>)}
                  </Select>
                </div>
              ) : null}

              {!profileId ? (
                <>
                  {columns.length === 0 ? <p className="rounded-xl bg-warning-soft p-4 text-sm text-warning">Choose a readable CSV file to map its columns.</p> : (
                    <>
                      <div className="grid gap-4 md:grid-cols-3">
                        <ColumnSelect id="mapping-date" label="Date" required columns={columns} value={mapping.dateColumn} onChange={(value) => updateMapping("dateColumn", value)} />
                        <ColumnSelect id="mapping-description" label="Description" required columns={columns} value={mapping.descriptionColumn} onChange={(value) => updateMapping("descriptionColumn", value)} />
                        <div><Label htmlFor="mapping-date-format">Date format</Label><Select id="mapping-date-format" value={mapping.dateFormat} onChange={(event) => setMapping((current) => ({ ...current, dateFormat: event.target.value }))}>{dateFormats.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}</Select></div>
                        <ColumnSelect id="mapping-reference" label="Reference" columns={columns} value={mapping.referenceColumn} onChange={(value) => updateMapping("referenceColumn", value)} />
                        <ColumnSelect id="mapping-balance" label="Running balance" columns={columns} value={mapping.balanceColumn} onChange={(value) => updateMapping("balanceColumn", value)} />
                      </div>

                      <fieldset>
                        <legend className="text-xs font-bold text-ink">Amount columns</legend>
                        <div className="mt-2 flex flex-wrap gap-4 text-sm">
                          <label className="flex items-center gap-2"><input id="amount-mode-signed" type="radio" name="amount-mode" checked={amountMode === "signed"} onChange={() => setAmountMode("signed")} /> One signed amount column</label>
                          <label className="flex items-center gap-2"><input id="amount-mode-split" type="radio" name="amount-mode" checked={amountMode === "split"} onChange={() => setAmountMode("split")} /> Separate debit and credit columns</label>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          {amountMode === "signed" ? <ColumnSelect id="mapping-amount" label="Signed amount" required columns={columns} value={mapping.amountColumn} onChange={(value) => updateMapping("amountColumn", value)} /> : (
                            <>
                              <ColumnSelect id="mapping-debit" label="Debit / money out" required columns={columns} value={mapping.debitColumn} onChange={(value) => updateMapping("debitColumn", value)} />
                              <ColumnSelect id="mapping-credit" label="Credit / money in" required columns={columns} value={mapping.creditColumn} onChange={(value) => updateMapping("creditColumn", value)} />
                            </>
                          )}
                        </div>
                        <p className="mt-3 text-xs leading-5 text-ink-muted">Money Matrix normalizes money in as positive and money out as negative. For liability accounts, the ledger posting is converted automatically without changing this review amount.</p>
                      </fieldset>
                    </>
                  )}
                </>
              ) : <p className="rounded-xl bg-info-soft p-4 text-sm text-ink-muted">The selected saved profile supplies this file’s column names and date format.</p>}
            </div>
          </Panel>
        ) : null}

        {formError || mutation.error ? <p className="rounded-xl bg-danger-soft p-4 text-sm text-danger" role="alert">{formError ?? mutation.error?.message}</p> : null}
        <div className="flex justify-end gap-3"><Link to="/imports" className={buttonStyles()}>Cancel</Link><Button variant="primary" type="submit" disabled={mutation.isPending || !file}>{mutation.isPending ? "Uploading…" : <><Upload className="size-4" /> Upload and review</>}</Button></div>
      </form>
    </>
  );
}

function ColumnSelect({ id, label, required = false, columns, value, onChange }: { id: string; label: string; required?: boolean; columns: string[]; value: string; onChange: (value: string) => void }) {
  return <div><Label htmlFor={id}>{label} {!required ? <span className="font-normal text-ink-muted">(optional)</span> : null}</Label><Select id={id} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose column</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</Select></div>;
}
