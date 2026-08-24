import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-surface shadow-panel", className)}
      {...props}
    />
  );
}

export function PanelHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
      <h2 className="text-sm font-bold tracking-tight text-ink">{title}</h2>
      {action}
    </div>
  );
}
