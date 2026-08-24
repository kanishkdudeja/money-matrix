import type { operations } from "../../api/generated";
import { validateCSVMapping, type CSVMapping } from "../imports/csv-mapping";

export type ProfileFormValues = CSVMapping & {
  name: string;
  institution: string;
  parserVersion: string;
  amountMode: "signed" | "split";
};

export type CreateParserProfile = operations["createParserProfile"]["requestBody"]["content"]["application/json"];

export function buildParserProfile(values: ProfileFormValues): CreateParserProfile {
  const name = values.name.trim();
  const parserVersion = values.parserVersion.trim();
  if (!name) throw new Error("Profile name is required.");
  if (!parserVersion) throw new Error("Version is required.");
  const mapping: CSVMapping = values.amountMode === "signed"
    ? { dateColumn: values.dateColumn, descriptionColumn: values.descriptionColumn, referenceColumn: values.referenceColumn, amountColumn: values.amountColumn, debitColumn: "", creditColumn: "", balanceColumn: values.balanceColumn, dateFormat: values.dateFormat }
    : { dateColumn: values.dateColumn, descriptionColumn: values.descriptionColumn, referenceColumn: values.referenceColumn, amountColumn: "", debitColumn: values.debitColumn, creditColumn: values.creditColumn, balanceColumn: values.balanceColumn, dateFormat: values.dateFormat };
  const mappingError = validateCSVMapping(mapping);
  if (mappingError) throw new Error(mappingError);
  return { name, format: "csv", institution: values.institution.trim() || null, mapping, parserVersion };
}

export function mappingField(mapping: Record<string, unknown>, key: keyof CSVMapping): string {
  const value = mapping[key];
  return typeof value === "string" ? value : "";
}
