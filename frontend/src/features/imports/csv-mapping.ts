export type CSVMapping = {
  dateColumn: string;
  descriptionColumn: string;
  referenceColumn: string;
  amountColumn: string;
  debitColumn: string;
  creditColumn: string;
  balanceColumn: string;
  dateFormat: string;
};

export const emptyCSVMapping: CSVMapping = {
  dateColumn: "",
  descriptionColumn: "",
  referenceColumn: "",
  amountColumn: "",
  debitColumn: "",
  creditColumn: "",
  balanceColumn: "",
  dateFormat: "02/01/2006",
};

const guesses: Record<Exclude<keyof CSVMapping, "dateFormat">, RegExp[]> = {
  dateColumn: [/^date$/i, /transaction.?date/i, /value.?date/i],
  descriptionColumn: [/^description$/i, /narration/i, /particulars/i, /merchant/i, /details/i],
  referenceColumn: [/reference/i, /^ref/i, /transaction.?id/i, /^utr/i],
  amountColumn: [/^amount$/i, /transaction.?amount/i],
  debitColumn: [/debit/i, /withdrawal/i],
  creditColumn: [/credit/i, /deposit/i],
  balanceColumn: [/balance/i],
};

export function parseCSVHeader(text: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      fields.push(field.trim());
      return fields.map((value, fieldIndex) => fieldIndex === 0 ? value.replace(/^\uFEFF/, "") : value);
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("The CSV header contains an unclosed quote.");
  fields.push(field.trim());
  return fields.map((value, fieldIndex) => fieldIndex === 0 ? value.replace(/^\uFEFF/, "") : value);
}

export function guessCSVMapping(columns: string[]): CSVMapping {
  const find = (patterns: RegExp[]) => columns.find((column) => patterns.some((pattern) => pattern.test(column))) ?? "";
  return {
    ...emptyCSVMapping,
    dateColumn: find(guesses.dateColumn),
    descriptionColumn: find(guesses.descriptionColumn),
    referenceColumn: find(guesses.referenceColumn),
    amountColumn: find(guesses.amountColumn),
    debitColumn: find(guesses.debitColumn),
    creditColumn: find(guesses.creditColumn),
    balanceColumn: find(guesses.balanceColumn),
  };
}

export function validateCSVMapping(mapping: CSVMapping): string | null {
  if (!mapping.dateColumn || !mapping.descriptionColumn) return "Choose the date and description columns.";
  if (mapping.amountColumn) return null;
  if (!mapping.debitColumn || !mapping.creditColumn) return "Choose one signed amount column, or both debit and credit columns.";
  return null;
}
