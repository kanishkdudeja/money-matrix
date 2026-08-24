import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { server } from "../../test/server";
import { ParserProfilesPage } from "./parser-profiles-page";

describe("ParserProfilesPage", () => {
  it("infers a mapping from a sample header and creates an immutable profile version", async () => {
    let command: unknown;
    server.use(
      http.get("*/api/parser-profiles", () => HttpResponse.json({ items: [] })),
      http.post("*/api/parser-profiles", async ({ request }) => {
        command = await request.json();
        return HttpResponse.json({ id: "profile-1", ...(command as object), createdAt: "2026-08-23T00:00:00Z" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MemoryRouter><ParserProfilesPage /></MemoryRouter></QueryClientProvider>);

    await user.click(await screen.findByRole("button", { name: "New profile" }));
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    expect(screen.getByLabelText("Profile name")).toHaveFocus();

    await user.type(screen.getByLabelText("Profile name"), "Bank CSV");
    const sample = new File(["Date,Description,Debit,Credit,Balance\n"], "sample.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText(/Sample CSV/), sample);
    expect(await screen.findByLabelText("Date column")).toHaveValue("Date");
    expect(screen.getByLabelText("Debit column")).toHaveValue("Debit");
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => expect(command).toMatchObject({ name: "Bank CSV", format: "csv", parserVersion: "1", mapping: { dateColumn: "Date", debitColumn: "Debit", creditColumn: "Credit" } }));
    expect(await screen.findByRole("status")).toHaveTextContent("created");
  });
});
