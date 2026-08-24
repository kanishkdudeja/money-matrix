import { cn } from "../../lib/cn";

type Tone = "neutral" | "positive" | "warning" | "danger" | "info";

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
        tone === "neutral" && "bg-canvas text-ink-muted",
        tone === "positive" && "bg-primary-soft text-primary-strong",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "info" && "bg-info-soft text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}
