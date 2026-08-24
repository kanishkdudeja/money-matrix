import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export function buttonStyles(variant: ButtonVariant = "secondary", className?: string): string {
  return cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
    variant === "primary" && "bg-primary text-white hover:bg-primary-strong dark:text-canvas",
    variant === "secondary" && "border border-line bg-surface-raised text-ink hover:bg-primary-soft",
    variant === "ghost" && "text-ink-muted hover:bg-primary-soft hover:text-ink",
    className,
  );
}
