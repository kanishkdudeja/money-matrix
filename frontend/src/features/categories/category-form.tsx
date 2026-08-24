import { useForm, useWatch } from "react-hook-form";

import type { Category } from "../../api/queries";
import { Button } from "../../components/ui/button";
import { FieldError, Input, Label, Select } from "../../components/ui/form";
import { useCreateCategory } from "../catalogs/mutations";

interface CategoryFormValues { name: string; kind: "income" | "expense"; parentId: string }

export function CategoryForm({ categories, onCreated, onCancel }: { categories: Category[]; onCreated: (name: string) => void; onCancel: () => void }) {
  const mutation = useCreateCategory();
  const { register, control, handleSubmit, formState: { errors } } = useForm<CategoryFormValues>({ defaultValues: { name: "", kind: "expense", parentId: "" } });
  const kind = useWatch({ control, name: "kind" });
  const parents = categories.filter((category) => !category.archived && category.kind === kind && !category.parentId);

  return (
    <form onSubmit={(event) => void handleSubmit((values) => {
      mutation.mutate(
        { name: values.name.trim(), kind: values.kind, parentId: values.parentId || null },
        { onSuccess: () => onCreated(values.name.trim()) },
      );
    })(event)} className="space-y-5">
      <div>
        <Label htmlFor="category-name">Name</Label>
        <Input id="category-name" {...register("name", { required: "Category name is required." })} />
        <FieldError>{errors.name?.message}</FieldError>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="category-kind">Type</Label>
          <Select id="category-kind" {...register("kind")}><option value="expense">Expense</option><option value="income">Income</option></Select>
        </div>
        <div>
          <Label htmlFor="category-parent">Parent <span className="font-normal text-ink-muted">(optional)</span></Label>
          <Select id="category-parent" {...register("parentId")}>
            <option value="">Top-level category</option>
            {parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
          </Select>
        </div>
      </div>
      {mutation.error ? <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{mutation.error.message}</p> : null}
      <div className="flex justify-end gap-3">
        <Button onClick={onCancel} disabled={mutation.isPending}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating…" : "Create category"}</Button>
      </div>
    </form>
  );
}
