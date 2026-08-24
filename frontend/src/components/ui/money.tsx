import { cn } from "../../lib/cn";
import { compareAmounts, formatMoney, type MoneyAmount } from "../../lib/money";

export function Money({
  amount,
  className,
  colorize = false,
  showPlus = false,
}: {
  amount: MoneyAmount;
  className?: string;
  colorize?: boolean;
  showPlus?: boolean;
}) {
  const comparison = compareAmounts(amount, "0");

  return (
    <span
      className={cn(
        "tabular-nums whitespace-nowrap",
        colorize && comparison < 0 && "text-danger",
        colorize && comparison > 0 && "text-primary",
        className,
      )}
    >
      {formatMoney(amount, { showPlus })}
    </span>
  );
}
