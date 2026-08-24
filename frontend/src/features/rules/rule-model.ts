import type { components } from "../../api/generated";
import { compareAmounts, formatMoney, parseDisplayAmount } from "../../lib/money";

export type RuleFormValues = {
  name: string;
  priority: string;
  descriptionContains: string;
  direction: "" | "debit" | "credit";
  minimumAmount: string;
  maximumAmount: string;
  bucketId: string;
  categoryId: string;
};

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

export function buildRuleCommand(values: RuleFormValues): components["schemas"]["CreateRule"] {
  const name = values.name.trim();
  if (!name) throw new Error("Rule name is required.");
  const priority = Number(values.priority || "0");
  if (!Number.isInteger(priority)) throw new Error("Priority must be a whole number.");
  if (!values.bucketId && !values.categoryId) throw new Error("Choose at least one suggested bucket or category.");

  const conditions: Record<string, unknown> = {};
  if (values.descriptionContains.trim()) conditions.descriptionContains = values.descriptionContains.trim();
  if (values.direction) conditions.direction = values.direction;
  if (values.minimumAmount.trim()) conditions.minimumAmount = thresholdAmount(values.minimumAmount, "Minimum amount");
  if (values.maximumAmount.trim()) conditions.maximumAmount = thresholdAmount(values.maximumAmount, "Maximum amount");
  if (Object.keys(conditions).length === 0) throw new Error("Add at least one matching condition.");
  if (typeof conditions.minimumAmount === "number" && typeof conditions.maximumAmount === "number" && conditions.minimumAmount > conditions.maximumAmount) {
    throw new Error("Minimum amount must not exceed maximum amount.");
  }

  return {
    name,
    priority,
    conditions,
    bucketId: values.bucketId || null,
    categoryId: values.categoryId || null,
    autoApply: false,
  };
}

function thresholdAmount(value: string, label: string): number {
  const amount = parseDisplayAmount(value);
  if (compareAmounts(amount, "0") < 0) throw new Error(`${label} cannot be negative.`);
  const exact = BigInt(amount);
  if (exact > maximumSafeInteger) throw new Error(`${label} is too large for a rule threshold.`);
  return Number(exact);
}

export function describeConditions(conditions: Record<string, unknown>): string[] {
  const descriptions: string[] = [];
  if (typeof conditions.descriptionContains === "string" && conditions.descriptionContains) descriptions.push(`Description contains “${conditions.descriptionContains}”`);
  if (conditions.direction === "debit") descriptions.push("Money out");
  if (conditions.direction === "credit") descriptions.push("Money in");
  if (typeof conditions.minimumAmount === "number") descriptions.push(`At least ${formatMoney(String(conditions.minimumAmount))}`);
  if (typeof conditions.maximumAmount === "number") descriptions.push(`At most ${formatMoney(String(conditions.maximumAmount))}`);
  return descriptions;
}
