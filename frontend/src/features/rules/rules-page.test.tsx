import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { server } from "../../test/server";
import { RulesPage } from "./rules-page";

describe("RulesPage", () => {
  it("focuses invalid fields and creates a review-only rule", async () => {
    let command: unknown;
    server.use(
      http.get("*/api/rules", () => HttpResponse.json({ items: [] })),
      http.get("*/api/buckets", () => HttpResponse.json({ items: [{ id: "bucket-food", name: "Food", balance: "0", archived: false, system: false }] })),
      http.get("*/api/categories", () => HttpResponse.json({ items: [{ id: "category-grocery", name: "Groceries", kind: "expense", archived: false }] })),
      http.post("*/api/rules", async ({ request }) => {
        command = await request.json();
        return HttpResponse.json({ id: "rule-1", ...(command as object), enabled: true, createdAt: "2026-08-23T00:00:00Z", updatedAt: "2026-08-23T00:00:00Z" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MemoryRouter><RulesPage /></MemoryRouter></QueryClientProvider>);

    await user.click(await screen.findByRole("button", { name: "New rule" }));
    await user.click(screen.getByRole("button", { name: "Create rule" }));
    expect(screen.getByLabelText("Rule name")).toHaveFocus();

    await user.type(screen.getByLabelText("Rule name"), "Market purchases");
    await user.type(screen.getByLabelText("Description contains"), "MARKET");
    await user.selectOptions(screen.getByLabelText(/Bucket/), "bucket-food");
    await user.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(command).toMatchObject({ name: "Market purchases", conditions: { descriptionContains: "MARKET" }, bucketId: "bucket-food", autoApply: false }));
    expect(await screen.findByRole("status")).toHaveTextContent("created");
  });
});
