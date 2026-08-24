import { useForm } from "react-hook-form";

import { Button } from "../../components/ui/button";
import { FieldError, Input, Label, Select, Textarea } from "../../components/ui/form";
import { useCreateAccount } from "../catalogs/mutations";

interface AccountFormValues {
  name: string;
  kind: "bank" | "cash" | "credit_card" | "loan" | "investment" | "other";
  balanceClass: "asset" | "liability";
  note: string;
}

export function AccountForm({ onCreated, onCancel }: { onCreated: (name: string) => void; onCancel: () => void }) {
  const mutation = useCreateAccount();
  const { register, handleSubmit, formState: { errors } } = useForm<AccountFormValues>({
    defaultValues: { name: "", kind: "bank", balanceClass: "asset", note: "" },
  });

  return (
    <form
      onSubmit={(event) => void handleSubmit((values) => {
        mutation.mutate(
          {
            name: values.name.trim(),
            kind: values.kind,
            balanceClass: values.balanceClass,
            currency: "INR",
            note: values.note.trim() || null,
          },
          { onSuccess: () => onCreated(values.name.trim()) },
        );
      })(event)}
      className="space-y-5"
    >
      <div>
        <Label htmlFor="account-name">Name</Label>
        <Input id="account-name" {...register("name", { required: "Account name is required." })} />
        <FieldError>{errors.name?.message}</FieldError>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="account-kind">Account type</Label>
          <Select id="account-kind" {...register("kind")}>
            <option value="bank">Bank</option><option value="cash">Cash</option><option value="credit_card">Credit card</option>
            <option value="loan">Loan</option><option value="investment">Investment</option><option value="other">Other</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="account-class">Balance class</Label>
          <Select id="account-class" {...register("balanceClass")}>
            <option value="asset">Asset</option><option value="liability">Liability</option>
          </Select>
          <p className="mt-1.5 text-xs leading-5 text-ink-muted">Credit cards and loans are normally liabilities.</p>
        </div>
      </div>
      <div>
        <Label htmlFor="account-note">Note <span className="font-normal text-ink-muted">(optional)</span></Label>
        <Textarea id="account-note" {...register("note")} />
      </div>
      {mutation.error ? <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{mutation.error.message}</p> : null}
      <div className="flex justify-end gap-3 pt-1">
        <Button onClick={onCancel} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating…" : "Create account"}</Button>
      </div>
    </form>
  );
}
