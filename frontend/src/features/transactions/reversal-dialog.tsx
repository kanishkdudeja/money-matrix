import { useForm } from "react-hook-form";

import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/form";
import { useReverseTransaction } from "./mutations";

interface ReversalValues { description: string }

export function ReversalDialog({
  transactionId,
  transactionDescription,
  open,
  onOpenChange,
  onReversed,
}: {
  transactionId: string;
  transactionDescription: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReversed: (reversalId: string) => void;
}) {
  const mutation = useReverseTransaction();
  const { register, handleSubmit } = useForm<ReversalValues>({
    values: { description: `Reversal of ${transactionDescription}` },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Reverse this transaction?"
      description="Money Matrix will preserve this record, mark it reversed, and create a new transaction with exactly opposite postings and BucketEntries."
    >
      <form onSubmit={(event) => void handleSubmit((values) => {
        mutation.mutate(
          { id: transactionId, description: values.description.trim() || "Reversal" },
          { onSuccess: (reversal) => onReversed(reversal.id) },
        );
      })(event)} className="space-y-5">
        <div>
          <Label htmlFor="reversal-description">Reversal description</Label>
          <Input id="reversal-description" {...register("description")} />
        </div>
        <p className="rounded-xl bg-warning-soft p-3 text-xs leading-5 text-warning">This is an audit-preserving correction, not a merchant refund. It cannot be undone by editing the original.</p>
        {mutation.error ? <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{mutation.error.message}</p> : null}
        <div className="flex justify-end gap-3">
          <Button onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Reversing…" : "Create reversal"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
