# Money Matrix frontend

React and TypeScript client for the Money Matrix Go API.

## Run locally

From the repository root:

```sh
mise run frontend:install
mise run frontend
```

Vite listens on `http://localhost:4040` and proxies `/api` and `/health` to `http://localhost:6060`. Set `VITE_API_BASE_URL` only when the API is intentionally hosted on another origin.

## Useful commands

```sh
npm run generate:api
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

Run these inside `frontend/`, or use `mise run frontend:check` from the repository root.

`src/api/generated.d.ts` is generated from `backend/openapi/openapi.yaml`; never edit it manually. API monetary values are signed integer strings in paise. All client arithmetic must go through `src/lib/money.ts` and remain exact.

The Playwright suite starts the Go API and Vite, migrates `E2E_DATABASE_URL` (or `TEST_DATABASE_URL`), and uses the locally installed Google Chrome. It covers a real ledger/import/reconciliation workflow as well as light/dark contrast and a 200%-equivalent responsive viewport.
