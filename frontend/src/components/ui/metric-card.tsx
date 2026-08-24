import type { LucideIcon } from "lucide-react";

import { Money } from "./money";
import { Panel } from "./panel";

export function MetricCard({
  label,
  amount,
  hint,
  icon: Icon,
}: {
  label: string;
  amount: string;
  hint: string;
  icon: LucideIcon;
}) {
  return (
    <Panel className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-muted">{label}</p>
          <Money amount={amount} className="mt-2 block text-2xl font-bold tracking-tight text-ink" />
        </div>
        <span className="rounded-xl bg-primary-soft p-2.5 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-4 text-xs leading-5 text-ink-muted">{hint}</p>
    </Panel>
  );
}
