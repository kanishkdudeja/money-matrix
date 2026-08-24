import { useForm } from "react-hook-form";

import { Button } from "../../components/ui/button";
import { FieldError, Input, Label, Textarea } from "../../components/ui/form";
import { useCreateBucket } from "../catalogs/mutations";

interface BucketFormValues { name: string; note: string }

export function BucketForm({ onCreated, onCancel }: { onCreated: (name: string) => void; onCancel: () => void }) {
  const mutation = useCreateBucket();
  const { register, handleSubmit, formState: { errors } } = useForm<BucketFormValues>({ defaultValues: { name: "", note: "" } });

  return (
    <form onSubmit={(event) => void handleSubmit((values) => {
      mutation.mutate({ name: values.name.trim(), note: values.note.trim() || null }, { onSuccess: () => onCreated(values.name.trim()) });
    })(event)} className="space-y-5">
      <div>
        <Label htmlFor="bucket-name">Name</Label>
        <Input id="bucket-name" {...register("name", { required: "Bucket name is required." })} />
        <FieldError>{errors.name?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="bucket-note">Purpose note <span className="font-normal text-ink-muted">(optional)</span></Label>
        <Textarea id="bucket-note" {...register("note")} />
      </div>
      {mutation.error ? <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{mutation.error.message}</p> : null}
      <div className="flex justify-end gap-3">
        <Button onClick={onCancel} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating…" : "Create bucket"}</Button>
      </div>
    </form>
  );
}
