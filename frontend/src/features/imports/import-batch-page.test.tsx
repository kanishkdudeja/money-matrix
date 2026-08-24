import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { server } from "../../test/server";
import { ImportBatchPage } from "./import-batch-page";

describe("ImportBatchPage", () => {
  it("submits a balanced default allocation for a pending row", async () => {
    let categorization: unknown;
    server.use(
      http.get("*/api/imports/batch-1", () => HttpResponse.json({
        id: "batch-1",
        accountId: "account-1",
        fileName: "bank.csv",
        status: "ready",
        createdAt: "2026-08-23T12:00:00Z",
        rows: [
          { id: "row-1", sourceRow: 2, transactionDate: "2026-08-23", description: "Corner market", amount: "-12345", transactionId: "transaction-1", reviewStatus: "pending", parseErrors: [] },
          { id: "row-2", sourceRow: 3, transactionDate: "2026-08-23", description: "Second row", amount: "-500", transactionId: "transaction-2", reviewStatus: "pending", parseErrors: [] },
        ],
      })),
      http.get("*/api/accounts", () => HttpResponse.json({ items: [
        { id: "account-1", name: "Daily bank", kind: "bank", balanceClass: "asset", currency: "INR", balance: "0", archived: false },
      ] })),
      http.get("*/api/buckets", () => HttpResponse.json({ items: [
        { id: "bucket-unallocated", name: "Unallocated", balance: "0", archived: false, system: true },
        { id: "bucket-food", name: "Food money", balance: "0", archived: false, system: false },
      ] })),
      http.get("*/api/categories", () => HttpResponse.json({ items: [
        { id: "category-grocery", name: "Groceries", kind: "expense", archived: false },
      ] })),
      http.get("*/api/imports/rows/row-1/suggestions", () => HttpResponse.json({ items: [] })),
      http.put("*/api/imports/rows/row-1/categorization", async ({ request }) => {
        categorization = await request.json();
        return HttpResponse.json({ id: "row-1", transactionId: "transaction-1", reviewStatus: "reviewed" });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/imports/batch-1"]}>
          <Routes><Route path="/imports/:id" element={<ImportBatchPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("Amount (₹)")).toHaveValue("-123.45");
    await user.keyboard("j");
    expect(screen.getByRole("heading", { level: 2, name: "Second row" })).toBeInTheDocument();
    await user.keyboard("k");
    expect(screen.getByRole("heading", { level: 2, name: "Corner market" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Bucket"), "bucket-food");
    await user.selectOptions(screen.getByLabelText(/Category/), "category-grocery");
    await user.click(screen.getByRole("button", { name: "Save categorization" }));

    await waitFor(() => expect(categorization).toEqual({ bucketEntries: [{
      bucketId: "bucket-food",
      categoryId: "category-grocery",
      amount: "-12345",
      memo: null,
    }] }));
    expect(await screen.findByRole("status")).toHaveTextContent("Categorization saved");
    expect(screen.getByRole("heading", { level: 2, name: "Second row" })).toBeInTheDocument();
  });
});
