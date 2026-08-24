# Money Matrix project handoff

This document is the durable starting context for continuing Money Matrix in a fresh Codex CLI conversation or on another computer. Product concepts and schema details remain authoritative in the linked design documents; this file records the current implementation state, practical setup, and decisions that are easiest to lose between conversations.

## Current status

The initial local, single-user application is implemented across the Go backend and React frontend. There are no known blocking defects at the time of this handoff.

Implemented workflows include:

- Financial account, bucket, and category catalogs with supported archive/restore behavior
- Manual ledger transactions, exact posting and BucketEntry splits, and audit-preserving reversals
- Dashboard balances and the global financial-coverage equation
- CSV statement upload, reusable immutable parser-profile versions, import discovery, duplicate/invalid evidence, row review, categorization, and skipping
- Deterministic categorization-rule creation, suggestions, and deletion; suggestions require review and are not silently auto-applied
- Reconciliation draft, discard, balanced completion, latest-checkpoint reopen, recompletion, and reconciled-period protection
- Responsive light/dark frontend with focused validation failures, visible mutation results, J/K import-row navigation, and Ctrl/Cmd+Enter categorization saving
- Route-level frontend code splitting

The last complete verification passed:

- Go unit and PostgreSQL-backed integration tests
- Go race detector, `go vet`, build, and `govulncheck`
- sqlc and OpenAPI regeneration checks
- 38 Vitest unit/component tests
- Frontend type checking, linting, and production build
- Two Playwright tests against the real Go API and PostgreSQL: one critical financial workflow and one light/dark contrast plus 200%-equivalent responsive-layout check

## Canonical documents

- [Repository setup and commands](../README.md)
- [Financial concepts, product vision, design decisions, scope, and follow-up roadmap](financial-model-and-product-vision.md)
- [Readable database schema](database-schema.md)
- [Frontend architecture and delivery plan](frontend-plan.md)
- [Backend hardening decisions and hosted-product deferrals](backend-hardening-todo.md)
- [OpenAPI contract](../backend/openapi/openapi.yaml)
- [Editable schema diagram](personal-ledger-schema-v0.excalidraw)

Read those documents instead of reconstructing the financial model from code alone.

## Important decisions to preserve

- `Transaction` is the real-world event. `Posting` changes a financial account. `BucketEntry` records purpose allocation and carries the optional category, preserving category-to-bucket correlation.
- Account and bucket balances are derived from immutable ledger entries, not editable counters.
- Ordinary API/database money columns are named `amount` or `balance`, but values are signed integer strings in minor currency units. Frontend arithmetic stays exact through `bigint` and `src/lib/money.ts`.
- The initial product enforces INR. Multi-currency aggregation remains deferred until valuation and exchange semantics are designed.
- Coverage-changing transactions must satisfy the posting-to-BucketEntry equation. Central invariants are enforced through application services and deferred PostgreSQL constraints.
- Missing purpose allocation goes to the seeded system `Unallocated` bucket.
- Posted financial history is corrected through reversal, not editing or deletion.
- Parser profiles are immutable versions because imports retain their parser reference for auditability.
- Categorization rules are deterministic, inspectable suggestions. The stored `autoApply` metadata is not currently an authorization for unattended mutation.
- The backend remains one Go service. Cross-table workflows go through narrow transaction-aware services; simple CRUD uses concrete sqlc queries instead of speculative repository interfaces.
- `internal/httpapi` remains the package name.
- There is no Fastify or Node application server. Vite proxies to the Go API during development, and production should normally use one origin.

## Known limitations and next work

The prioritized roadmap is in [financial-model-and-product-vision.md](financial-model-and-product-vision.md#follow-up-roadmap). The most important current limitations are:

- Import fingerprints deduplicate earlier imported rows, but an imported bank row is not yet matched to an equivalent manually entered transaction.
- Statement ingestion is CSV-only. XLSX and PDF/OCR adapters are deferred.
- Categorization is deterministic and review-driven; learned suggestions and confidence-based automatic application are deferred.
- Transaction filtering/search and supported account, bucket, or category rename/note editing are not yet implemented.
- Plans and recurring-transaction workflows are not implemented even though planning tables exist in the schema.
- Authentication, multi-user/household ownership, authorization, original-upload object storage, production deployment, and hosted operational controls are explicitly deferred.

These are product follow-ups, not reasons to redesign the existing ledger model.

## Moving to another computer

Source code and documentation should move through Git. PostgreSQL data is separate and must move through `pg_dump`/`pg_restore` if the local data matters.

Before leaving the current computer:

1. Review `git status` carefully.
2. Commit the repository and push it to a private remote. At the time this handoff was written, the repository had not yet made its initial commit, so the working tree must not be assumed to exist anywhere else.
3. Back up any wanted PostgreSQL data separately. Never commit `.env`, database dumps containing private financial data, or uploaded statements.

On the new computer:

1. Clone `https://github.com/kanishkdudeja/money-matrix.git` and enter its root directory.
2. Install the versions described in the root README: Go, PostgreSQL, Node/npm, and optionally Google Chrome for the Playwright suite.
3. Run `npm ci` through `make frontend-install`.
4. Copy `.env.example` to `.env`, create the development and test databases, and supply local credentials.
5. Run `make db-up` and then `make check`.
6. Run `make frontend-e2e` when the dedicated/fallback test database and local Chrome are available.
7. Restore application data with PostgreSQL tools if desired.

Do not copy the whole Codex configuration directory merely to transfer this project. It can include credentials, approvals, caches, plugins, and machine-specific settings, and session-file portability is not a documented Codex CLI contract.

## Starting a fresh Codex CLI conversation

Start Codex from the cloned repository root and use a prompt similar to:

> Continue work on Money Matrix. First read `README.md`, `docs/project-handoff.md`, `docs/financial-model-and-product-vision.md`, `docs/database-schema.md`, and `docs/frontend-plan.md`. Inspect the repository and current Git status before making changes. Treat the existing ledger invariants and terminology as deliberate. The initial local single-user backend/frontend is complete and verified; use the follow-up roadmap to discuss or implement the next phase. Do not add hosted-only authentication, ownership, or object storage unless I explicitly choose that phase.

A fresh conversation with this repository context is preferable to depending on a long historical transcript. The code, tests, and committed decisions are the authoritative state; the old conversation is useful background but should not override them.
