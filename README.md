# Money Matrix

A personal ledger for reconciling financial accounts, classifying transactions, and reserving money in virtual buckets.

Canonical repository: [github.com/kanishkdudeja/money-matrix](https://github.com/kanishkdudeja/money-matrix)

## Documentation

- [Product vision and financial model](docs/financial-model-and-product-vision.md)
- [Database schema reference](docs/database-schema.md)
- [Frontend implementation plan](docs/frontend-plan.md)
- [Project handoff for a new machine or Codex session](docs/project-handoff.md)
- [Editable Excalidraw schema diagram](docs/personal-ledger-schema-v0.excalidraw)
- [OpenAPI contract](backend/openapi/openapi.yaml)

## Local development

Requirements:

- Go 1.27+
- PostgreSQL 18
- Node.js 24 and npm 11 (the exact Node version is in `frontend/.nvmrc`)

Copy `.env.example` to `.env`, create the referenced databases, and then run:

```sh
make db-up
make backend-run
```

The API exposes liveness and database-readiness checks at `/health/live` and `/health/ready`.

In a second terminal, install the pinned frontend dependency tree and start Vite:

```sh
make frontend-install
make frontend-run
```

Open `http://localhost:5173`. Vite proxies `/api` and `/health` directly to the Go API at `http://localhost:8080`; there is no Node or Fastify application server. A production deployment can serve `frontend/dist` and the Go API behind the same origin.

PostgreSQL can run natively or through `compose.yaml`; the application only depends on `DATABASE_URL`.

## Initial backend scope

The initial API supports:

- Financial accounts with asset/liability balance classes and computed balances
- Income, expense, transfer, refund, adjustment, opening-balance, and bucket-transfer transactions
- Atomic financial postings and split bucket entries with an optional category on each split
- Automatic placement of uncategorized coverage changes in the system `Unallocated` bucket
- Transaction reversals and protection of completed reconciliation periods
- Categories, buckets, dashboard totals, and the global coverage equation
- Reusable statement parser profiles and multipart CSV statement imports
- Duplicate fingerprints, invalid-row preservation, review categorization, and skipping
- Atomic upload rollback, terminal duplicate-only batches, and status-filtered import discovery
- Deterministic categorization-rule suggestions
- Account reconciliation checkpoints with live computed differences, protected draft discard, complete/reopen lifecycle, ordering, and fixed posting membership
- Transaction CSV export

The complete HTTP contract is in `backend/openapi/openapi.yaml`.

## Initial frontend scope

The React frontend currently provides a responsive financial workspace for:

- Dashboard totals, the global coverage equation, Unallocated money, and recent activity
- Account, bucket, and income/expense category catalogs
- Creating, archiving, and restoring catalog records where supported
- Preset-driven manual income, expense, refund, account-transfer, bucket-transfer, opening-balance, and adjustment entry
- Advanced editable posting and BucketEntry splits with live coverage validation
- Paginated transactions, CSV export, transaction-level ledger detail, and audit-preserving reversals
- CSV statement upload with saved-profile or inline column mapping
- Status-filtered import discovery and two-pane row review with rule suggestions, exact BucketEntry splits, skip handling, and read-only duplicate/invalid evidence
- Reconciliation drafts with computed-versus-statement guidance, balanced completion, protected draft discard, and latest-checkpoint reopen
- Categorization-rule creation, validation, discovery, and deletion with review-only suggestions
- Immutable versioned CSV parser-profile creation and discovery
- J/K import-row navigation, Ctrl/Cmd+Enter review saving, focused validation failures, and visible mutation results
- Exact INR formatting and arithmetic using integer strings and `bigint`
- Clear loading, empty, API-problem, retry, mobile-navigation, and light/dark-theme states

TypeScript API definitions in `frontend/src/api/generated.d.ts` are generated from the same OpenAPI document used for the Go server. Playwright covers the critical browser workflow against the real Go API and PostgreSQL, plus light/dark contrast and responsive reflow at a 200%-equivalent viewport.

## Backend structure

- `backend/cmd/api` is the composition root and process lifecycle.
- `backend/internal/httpapi` adapts generated OpenAPI routes to application operations.
- `backend/internal/ledger`, `backend/internal/importing`, and `backend/internal/reconciliation` own cross-table financial workflows.
- `backend/internal/database` owns the pgx pool and serializable transaction runner.
- `backend/database/queries` is the only production SQL source; sqlc generates type-safe access code.

Interfaces are intentionally consumer-defined and narrow. The important one is the transaction boundary used by multi-table workflows; concrete sqlc queries are used where an additional abstraction would not buy anything. PostgreSQL deferred triggers backstop committed ledger equations even if a future code path bypasses a service.

## Frontend structure

- `frontend/src/app` owns composition, providers, routing, and theming.
- `frontend/src/api` contains the generated OpenAPI contract, the one configured client, typed problems, and query definitions.
- `frontend/src/features` owns route-level financial screens and feature-specific components.
- `frontend/src/components` contains reusable layout and visual primitives.
- `frontend/src/lib/money.ts` is the exact minor-unit boundary; API money is never converted to floating point.
- `frontend/src/test` owns the shared MSW transport mock and browser-like test setup.
- `frontend/e2e` owns the small real-browser workflow suite and database migration setup.

## Verification

```sh
make backend-test
make backend-build
make frontend-check
make frontend-e2e
make check
```

Backend tests combine fast unit tests with PostgreSQL-backed HTTP workflow tests using `money_matrix_test`. Frontend tests cover exact financial utilities and user-visible components through Vitest, Testing Library, and MSW. `make frontend-e2e` starts the real Go and Vite servers, migrates `E2E_DATABASE_URL` (falling back to `TEST_DATABASE_URL`), and drives the installed Chrome browser through the critical workflow. Use a dedicated disposable PostgreSQL database for E2E outside local development.

`make check` requires `TEST_DATABASE_URL`; it verifies generated code, formatting, type safety, linting, unit/integration/component tests, the Go race detector and vet, production builds, and `govulncheck`.

## Database portability

Schema state is recreated from Goose migrations. Data can be moved independently with PostgreSQL's `pg_dump` and `pg_restore`. PostgreSQL 18 containers persist data under `/var/lib/postgresql`, as reflected in `compose.yaml`.
