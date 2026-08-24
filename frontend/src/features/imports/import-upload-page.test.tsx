import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { server } from "../../test/server";
import { ImportUploadPage } from "./import-upload-page";

describe("ImportUploadPage", () => {
  it("uploads a CSV with its inferred mapping and opens the review batch", async () => {
    let requested = false;
    let contentType = "";
    server.use(
      http.get("*/api/accounts", () => HttpResponse.json({ items: [
        { id: "account-1", name: "Daily bank", kind: "bank", balanceClass: "asset", currency: "INR", balance: "0", archived: false },
      ] })),
      http.get("*/api/parser-profiles", () => HttpResponse.json({ items: [] })),
      http.post("*/api/imports/csv", ({ request }) => {
        requested = true;
        contentType = request.headers.get("content-type") ?? "";
        return HttpResponse.json({ id: "batch-1", status: "ready", imported: 1, duplicates: 0, invalid: 0 }, { status: 201 });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/imports/new"]}>
          <Routes>
            <Route path="/imports/new" element={<ImportUploadPage />} />
            <Route path="/imports/:id" element={<p>Review batch</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const file = new File(["Date,Description,Debit,Credit,Balance\n23/08/2026,Market,100.00,,900.00\n"], "bank.csv", { type: "text/csv" });
    await user.upload(await screen.findByLabelText("CSV statement"), file);
    expect(await screen.findByLabelText("Debit / money out")).toHaveValue("Debit");
    const submitButton = screen.getByRole("button", { name: "Upload and review" });
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    expect(await screen.findByText("Review batch")).toBeInTheDocument();
    await waitFor(() => expect(requested).toBe(true));
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });
});
