import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { DashboardPage } from "./dashboard-page";
import { server } from "../../test/server";

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DashboardPage", () => {
  it("renders the backend financial equation and outstanding work", async () => {
    server.use(
      http.get("*/api/dashboard", () =>
        HttpResponse.json({
          assets: "1000000",
          liabilities: "-250000",
          netCovered: "750000",
          bucketTotal: "750000",
          difference: "0",
          balanced: true,
          importsNeedingReview: 2,
        }),
      ),
      http.get("*/api/accounts", () => HttpResponse.json({ items: [] })),
      http.get("*/api/buckets", () =>
        HttpResponse.json({
          items: [
            {
              id: "67636523-e48f-4d46-ae07-24533f656062",
              name: "Unallocated",
              balance: "12500",
              archived: false,
              system: true,
            },
          ],
        }),
      ),
      http.get("*/api/transactions", () => HttpResponse.json({ items: [], limit: 5, offset: 0 })),
    );

    renderDashboard();

    expect(await screen.findByText("Your money, mapped clearly.")).toBeInTheDocument();
    expect(screen.getByText("₹10,000.00")).toBeInTheDocument();
    expect(screen.getAllByText("₹7,500.00")).toHaveLength(2);
    expect(screen.getByText("₹125.00")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("2 imported transactions awaiting review");
    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });

  it("turns an API problem into a useful retry state", async () => {
    server.use(
      http.get("*/api/dashboard", () =>
        HttpResponse.json(
          { type: "about:blank", title: "Database unavailable", status: 503, detail: "PostgreSQL is not ready." },
          { status: 503, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
      http.get("*/api/accounts", () => HttpResponse.json({ items: [] })),
      http.get("*/api/buckets", () => HttpResponse.json({ items: [] })),
      http.get("*/api/transactions", () => HttpResponse.json({ items: [], limit: 5, offset: 0 })),
    );

    renderDashboard();

    expect(await screen.findByText("We couldn’t load this view")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL is not ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
