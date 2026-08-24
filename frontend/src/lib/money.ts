export type MoneyAmount = string;

const amountPattern = /^-?\d+$/;
const displayPattern = /^([+-]?)(?:(\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/;
const wholeFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

function asMinorUnits(amount: MoneyAmount): bigint {
  if (!amountPattern.test(amount)) {
    throw new TypeError(`Invalid minor-unit amount: ${amount}`);
  }

  return BigInt(amount);
}

export function parseDisplayAmount(value: string): MoneyAmount {
  const normalized = value.replace(/[₹,\s]/g, "");
  const match = displayPattern.exec(normalized);

  if (!match) {
    throw new TypeError("Enter a rupee amount with no more than two decimal places.");
  }

  const [, sign, wholePart, decimalFromWhole, decimalWithoutWhole] = match;
  const whole = BigInt(wholePart ?? "0");
  const decimal = (decimalFromWhole ?? decimalWithoutWhole ?? "").padEnd(2, "0");
  const absolute = whole * 100n + BigInt(decimal || "0");

  if (absolute === 0n) {
    return "0";
  }

  return `${sign === "-" ? "-" : ""}${absolute}`;
}

export function formatMoney(amount: MoneyAmount, options: { showPlus?: boolean } = {}): string {
  const value = asMinorUnits(amount);
  const absolute = value < 0n ? -value : value;
  const rupees = absolute / 100n;
  const paise = absolute % 100n;
  const sign = value < 0n ? "−" : options.showPlus && value > 0n ? "+" : "";

  return `${sign}₹${wholeFormatter.format(rupees)}.${paise.toString().padStart(2, "0")}`;
}

export function negateAmount(amount: MoneyAmount): MoneyAmount {
  return (-asMinorUnits(amount)).toString();
}

export function sumAmounts(amounts: readonly MoneyAmount[]): MoneyAmount {
  return amounts.reduce((total, amount) => total + asMinorUnits(amount), 0n).toString();
}

export function compareAmounts(left: MoneyAmount, right: MoneyAmount): -1 | 0 | 1 {
  const leftValue = asMinorUnits(left);
  const rightValue = asMinorUnits(right);

  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

export function isNegativeAmount(amount: MoneyAmount): boolean {
  return asMinorUnits(amount) < 0n;
}

export function toDisplayAmount(amount: MoneyAmount): string {
  const value = asMinorUnits(amount);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
