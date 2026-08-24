import { AlertCircle, Inbox, LoaderCircle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./button";
import { Panel } from "./panel";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="max-w-3xl">
        {eyebrow ? <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p> : null}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted sm:text-base">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function LoadingState({ label = "Loading your financial picture…" }: { label?: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-ink-muted" role="status">
      <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "The request could not be completed.";

  return (
    <Panel className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
      <span className="mb-4 rounded-full bg-danger-soft p-3 text-danger">
        <AlertCircle className="size-6" aria-hidden="true" />
      </span>
      <h2 className="text-base font-bold">We couldn’t load this view</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-ink-muted">{message}</p>
      {onRetry ? (
        <Button className="mt-5" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden="true" /> Retry
        </Button>
      ) : null}
    </Panel>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-4 rounded-full bg-primary-soft p-3 text-primary">
        <Inbox className="size-6" aria-hidden="true" />
      </span>
      <h2 className="font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-ink-muted">{description}</p>
    </div>
  );
}
