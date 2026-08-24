import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { server } from "../../test/server";
import { ReconciliationsPage } from "./reconciliations-page";

const account = { id: "account-1", name: "Daily bank", kind: "bank", balanceClass: "asset", currency: "INR", balance: "123456", archived: false };

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter><ReconciliationsPage /></MemoryRouter></QueryClientProvider>);
}

describe("ReconciliationsPage", () => {
  it("creates an in-progress checkpoint using exact minor units", async () => {
    let submitted: unknown;
    server.use(
      http.get("*/api/accounts", () => HttpResponse.json({ items: [account] })),
      http.get("*/api/reconciliations", () => HttpResponse.json({ items: [] })),
      http.post("*/api/reconciliations", async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json({ id: "reconciliation-1", status: "in_progress", computedBalance: "123456", statementBalance: "123456", difference: "0" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New reconciliation" }));
    await user.clear(screen.getByLabelText("Statement ending date"));
    await user.type(screen.getByLabelText("Statement ending date"), "2026-08-31");
    await user.clear(screen.getByLabelText("Ending balance (₹)"));
    await user.type(screen.getByLabelText("Ending balance (₹)"), "1,234.56");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(submitted).toEqual({ financialAccountId: "account-1", statementDate: "2026-08-31", statementBalance: "123456", complete: false }));
  });

  it("completes a balanced draft after confirmation", async () => {
    let completed = false;
    const draft = { id: "reconciliation-1", financialAccountId: "account-1", statementDate: "2026-08-31", statementBalance: "123456", computedBalance: "123456", difference: "0", status: "in_progress" };
    server.use(
      http.get("*/api/accounts", () => HttpResponse.json({ items: [account] })),
      http.get("*/api/reconciliations", () => HttpResponse.json({ items: [draft] })),
      http.post("*/api/reconciliations/reconciliation-1/complete", () => {
        completed = true;
        return HttpResponse.json({ id: "reconciliation-1", status: "completed", computedBalance: "123456", statementBalance: "123456", difference: "0" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Complete" }));
    await user.click(screen.getByRole("button", { name: "Complete checkpoint" }));
    await waitFor(() => expect(completed).toBe(true));
  });

  it("offers reopen only on the latest completed checkpoint", async () => {
    let reopened = false;
    const items = [
      { id: "latest", financialAccountId: "account-1", statementDate: "2026-08-31", statementBalance: "123456", computedBalance: "123456", difference: "0", status: "completed", completedAt: "2026-09-01T12:00:00Z" },
      { id: "older", financialAccountId: "account-1", statementDate: "2026-07-31", statementBalance: "100000", computedBalance: "100000", difference: "0", status: "completed", completedAt: "2026-08-01T12:00:00Z" },
    ];
    server.use(
      http.get("*/api/accounts", () => HttpResponse.json({ items: [account] })),
      http.get("*/api/reconciliations", () => HttpResponse.json({ items })),
      http.post("*/api/reconciliations/latest/reopen", () => {
        reopened = true;
        return HttpResponse.json({ id: "latest", status: "reopened", computedBalance: "123456", statementBalance: "123456", difference: "0" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findAllByRole("button", { name: "Reopen" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await user.click(screen.getByRole("button", { name: "Reopen checkpoint" }));
    await waitFor(() => expect(reopened).toBe(true));
  });
});
