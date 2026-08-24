import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { Account, Transaction } from "../../api/queries";
import { TransactionRow } from "./transaction-row";

const accounts: Account[] = [
  {
    id: "c215be75-9483-49cc-9413-14dfefaa93cf",
    name: "Daily bank",
    kind: "bank",
    balanceClass: "asset",
    currency: "INR",
    balance: "125000",
    archived: false,
  },
];

const transaction: Transaction = {
  id: "256686cd-5041-469b-ac54-2fd520533e92",
  occurredOn: "2026-08-23",
  description: "Corner market",
  kind: "expense",
  status: "posted",
  origin: "manual",
  postings: [
    {
      id: "8be2d586-dbbd-42a1-a322-d090d15e5ee7",
      accountId: accounts[0]!.id,
      amount: "-48250",
    },
  ],
  bucketEntries: [
    {
      id: "d5ef7647-da19-409d-bcc8-86e91b0cd7a2",
      bucketId: "8f1ffbbd-4b7c-46bb-a566-c329265d4365",
      amount: "-48250",
    },
  ],
};

describe("TransactionRow", () => {
  it("shows the human transaction and links to its ledger detail", () => {
    render(
      <MemoryRouter>
        <TransactionRow transaction={transaction} accounts={accounts} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /corner market/i })).toHaveAttribute(
      "href",
      `/transactions/${transaction.id}`,
    );
    expect(screen.getByText("Daily bank")).toBeInTheDocument();
    expect(screen.getByText("−₹482.50")).toBeInTheDocument();
    expect(screen.getByText(/posted/i)).toBeInTheDocument();
  });
});
